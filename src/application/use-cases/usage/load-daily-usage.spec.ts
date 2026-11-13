import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../../domain/settings';
import { DAILY_USAGE_DAYS, localDayStarts, type RawDailyUsage } from '../../../domain/usage';
import type { DailyUsageReader } from '../../ports';
import { FakeClock } from '../../testing/fake-clock';
import { FakeSettingsStore } from '../../testing/fake-settings-store';
import { LoadDailyUsage } from './load-daily-usage';

const NOW = new Date(2026, 10, 13, 15, 0).getTime();

class FakeDailyUsageReader implements DailyUsageReader {
  calls: Array<readonly number[]> = [];
  replies: Array<RawDailyUsage | null | Error> = [];

  async read(dayStarts: readonly number[]): Promise<RawDailyUsage | null> {
    this.calls.push(dayStarts);
    const reply = this.replies.length > 0 ? (this.replies.shift() ?? null) : { complete: true, days: [] };
    if (reply instanceof Error) throw reply;
    return reply;
  }
}

async function setup(enabled: boolean) {
  const clock = new FakeClock();
  await clock.advance(NOW);
  const settings = new FakeSettingsStore({ ...createDefaultSettings(), usageDailyHistory: enabled });
  const reader = new FakeDailyUsageReader();
  return { reader, settings, load: new LoadDailyUsage(settings, reader, clock) };
}

describe('LoadDailyUsage', () => {
  it('does not scan anything while the switch is off', async () => {
    const { load, reader } = await setup(false);
    expect(await load.execute()).toBeNull();
    expect(reader.calls).toEqual([]);
  });

  it('reads the last days with local midnights as boundaries and builds the usage', async () => {
    const { load, reader } = await setup(true);
    const starts = localDayStarts(NOW, DAILY_USAGE_DAYS);
    reader.replies = [
      {
        complete: true,
        days: [
          { start: starts[5] ?? 0, models: [{ model: 'claude-opus-5-5', tokens: 100 }], sessions: 1, contextPeaks: [50] },
          { start: starts[6] ?? 0, models: [{ model: 'claude-haiku-5-5', tokens: 300 }], sessions: 2, contextPeaks: [10, 30] },
        ],
      },
    ];
    const usage = await load.execute();
    expect(reader.calls).toEqual([starts]);
    expect(starts).toHaveLength(DAILY_USAGE_DAYS + 1);
    expect(usage?.days.map((day) => [day.start, day.totalTokens, day.averageContext])).toEqual([
      [starts[6], 300, 20],
      [starts[5], 100, 50],
    ]);
    expect(usage?.modelShare.map((entry) => entry.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
  });

  it('a missing transcripts folder is no data', async () => {
    const { load, reader } = await setup(true);
    reader.replies = [null];
    expect(await load.execute()).toBeNull();
  });

  it('asks again while the scan is incomplete and stops once it is complete', async () => {
    const { load, reader } = await setup(true);
    const day = (tokens: number) => ({ start: 1, models: [{ model: 'm', tokens }], sessions: 1, contextPeaks: [1] });
    reader.replies = [
      { complete: false, days: [day(1)] },
      { complete: false, days: [day(2)] },
      { complete: true, days: [day(3)] },
    ];
    const usage = await load.execute();
    expect(reader.calls).toHaveLength(3);
    expect(usage?.totalTokens).toBe(3);
  });

  it('gives up after a bounded number of passes and still shows what it has', async () => {
    const { load, reader } = await setup(true);
    reader.replies = Array.from({ length: 20 }, () => ({
      complete: false,
      days: [{ start: 1, models: [{ model: 'm', tokens: 5 }], sessions: 1, contextPeaks: [1] }],
    }));
    const usage = await load.execute();
    expect(reader.calls.length).toBeLessThanOrEqual(10);
    expect(usage?.totalTokens).toBe(5);
  });

  it('propagates a reader failure so the caller can hide the block', async () => {
    const { load, reader } = await setup(true);
    reader.replies = [new Error('boom')];
    await expect(load.execute()).rejects.toThrow('boom');
  });
});
