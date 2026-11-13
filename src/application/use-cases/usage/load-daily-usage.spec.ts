import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../../domain/time';
import { DAILY_USAGE_DAYS, localDayStarts, type RawDailyUsage } from '../../../domain/usage';
import type { DailyUsageReader } from '../../ports';
import { FakeClock } from '../../testing/fake-clock';
import { DAILY_USAGE_MAX_PASSES, LoadDailyUsage } from './load-daily-usage';

const NOW = new Date(2026, 10, 13, 15, 0).getTime();

class FakeDailyUsageReader implements DailyUsageReader {
  calls: Array<readonly number[]> = [];
  replies: Array<RawDailyUsage | null | Error> = [];

  async read(dayStarts: readonly number[]): Promise<RawDailyUsage | null> {
    this.calls.push(dayStarts);
    const reply = this.replies.length > 0 ? (this.replies.shift() ?? null) : { complete: true, truncated: false, days: [] };
    if (reply instanceof Error) throw reply;
    return reply;
  }
}

const day = (tokens: number, start = 1) => ({ start, models: [{ model: 'm', tokens }], sessions: 1, contextPeaks: [1] });

async function setup() {
  const clock = new FakeClock();
  await clock.advance(NOW);
  const reader = new FakeDailyUsageReader();
  return { clock, reader, load: new LoadDailyUsage(reader, clock) };
}

describe('LoadDailyUsage', () => {
  it('reads the last days with local midnights as boundaries and builds the usage', async () => {
    const { load, reader } = await setup();
    const starts = localDayStarts(NOW, DAILY_USAGE_DAYS);
    reader.replies = [
      {
        complete: true,
        truncated: false,
        days: [
          { start: starts[5] ?? 0, models: [{ model: 'claude-opus-5-5', tokens: 100 }], sessions: 1, contextPeaks: [50] },
          { start: starts[6] ?? 0, models: [{ model: 'claude-haiku-5-5', tokens: 300 }], sessions: 2, contextPeaks: [10, 30] },
        ],
      },
    ];
    const usage = await load.execute();
    expect(reader.calls).toEqual([starts]);
    expect(starts).toHaveLength(DAILY_USAGE_DAYS + 1);
    expect(usage?.partial).toBe(false);
    expect(usage?.days.map((entry) => [entry.start, entry.totalTokens, entry.averageContext])).toEqual([
      [starts[6], 300, 20],
      [starts[5], 100, 50],
    ]);
    expect(usage?.modelShare.map((entry) => entry.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
  });

  it('sends shifted boundaries after midnight, so today moves', async () => {
    const { load, reader, clock } = await setup();
    await load.execute();
    await clock.advance(10 * 60 * 60_000);
    await load.execute();
    const [before, after] = reader.calls;
    expect(after?.[DAILY_USAGE_DAYS]).toBeGreaterThan(before?.[DAILY_USAGE_DAYS] ?? 0);
    expect(after?.[DAILY_USAGE_DAYS - 1]).toBe(before?.[DAILY_USAGE_DAYS]);
    expect((after?.[DAILY_USAGE_DAYS] ?? 0) - (after?.[DAILY_USAGE_DAYS - 1] ?? 0)).toBeLessThanOrEqual(DAY_MS + 3_600_000);
  });

  it('a missing transcripts folder is no data', async () => {
    const { load, reader } = await setup();
    reader.replies = [null];
    expect(await load.execute()).toBeNull();
  });

  it('asks again while the scan is incomplete and stops once it is complete', async () => {
    const { load, reader } = await setup();
    reader.replies = [
      { complete: false, truncated: false, days: [day(1)] },
      { complete: false, truncated: false, days: [day(2)] },
      { complete: true, truncated: false, days: [day(3)] },
    ];
    const usage = await load.execute();
    expect(reader.calls).toHaveLength(3);
    expect(usage?.totalTokens).toBe(3);
    expect(usage?.partial).toBe(false);
  });

  it('gives up after the bounded number of passes and marks what it shows as partial', async () => {
    const { load, reader } = await setup();
    reader.replies = Array.from({ length: 20 }, () => ({ complete: false, truncated: false, days: [day(5)] }));
    const usage = await load.execute();
    expect(reader.calls).toHaveLength(DAILY_USAGE_MAX_PASSES);
    expect(usage?.totalTokens).toBe(5);
    expect(usage?.partial).toBe(true);
  });

  it('a scan that left files out is partial even when complete', async () => {
    const { load, reader } = await setup();
    reader.replies = [{ complete: true, truncated: true, days: [day(5)] }];
    expect((await load.execute())?.partial).toBe(true);
    expect(reader.calls).toHaveLength(1);
  });

  it('propagates a reader failure so the caller can hide the block', async () => {
    const { load, reader } = await setup();
    reader.replies = [new Error('boom')];
    await expect(load.execute()).rejects.toThrow('boom');
  });
});
