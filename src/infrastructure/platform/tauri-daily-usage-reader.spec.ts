import { describe, expect, it } from 'vitest';
import { createFakeCommands, rejectWith } from '../testing/fakes';
import { PlatformCommandError } from './tauri-commands';
import { TauriDailyUsageReader, toRawDailyUsage } from './tauri-daily-usage-reader';

const REPLY = {
  complete: true,
  days: [
    { start: 1_800_000_000, models: [{ model: 'claude-opus-5-5', tokens: 1_200 }], sessions: 2, contextPeaks: [400_000, 100_000] },
    { start: 1_800_086_400, models: [], sessions: 0, contextPeaks: [] },
  ],
};

describe('toRawDailyUsage', () => {
  it('reads the days with the start as epoch ms', () => {
    expect(toRawDailyUsage(REPLY)).toEqual({
      complete: true,
      days: [
        { start: 1_800_000_000_000, models: [{ model: 'claude-opus-5-5', tokens: 1_200 }], sessions: 2, contextPeaks: [400_000, 100_000] },
        { start: 1_800_086_400_000, models: [], sessions: 0, contextPeaks: [] },
      ],
    });
  });

  it('a reply that is not an object with days means no data', () => {
    expect(toRawDailyUsage(null)).toBeNull();
    expect(toRawDailyUsage('x')).toBeNull();
    expect(toRawDailyUsage({ complete: true })).toBeNull();
  });

  it('malformed fields fall back to empty values and days without a start are dropped', () => {
    expect(
      toRawDailyUsage({
        complete: false,
        days: [
          null,
          { models: [] },
          { start: 5, models: [null, { model: '', tokens: 3 }, { model: 'm', tokens: -1 }, { model: 'n', tokens: 'x' }], sessions: 'two', contextPeaks: [0, -4, 7, 'x'] },
        ],
      }),
    ).toEqual({
      complete: false,
      days: [{ start: 5_000, models: [{ model: 'm', tokens: 0 }, { model: 'n', tokens: 0 }], sessions: 0, contextPeaks: [7] }],
    });
  });
});

describe('TauriDailyUsageReader', () => {
  it('calls daily_usage with the local day boundaries in seconds', async () => {
    const { commands, calls } = createFakeCommands(() => REPLY);
    const usage = await new TauriDailyUsageReader(commands).read([1_800_000_000_000, 1_800_086_400_999]);
    expect(usage?.days).toHaveLength(2);
    expect(calls).toEqual([{ command: 'daily_usage', args: { dayStarts: [1_800_000_000, 1_800_086_400] } }]);
  });

  it('a missing home folder is null and a Rust error propagates', async () => {
    expect(await new TauriDailyUsageReader(createFakeCommands(() => null).commands).read([1_000, 2_000])).toBeNull();
    const failing = new TauriDailyUsageReader(createFakeCommands(() => rejectWith('invalid_argument', 'invalid day range')).commands);
    await expect(failing.read([1])).rejects.toBeInstanceOf(PlatformCommandError);
  });
});
