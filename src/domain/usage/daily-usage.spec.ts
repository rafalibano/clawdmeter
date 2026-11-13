import { describe, expect, it } from 'vitest';
import { averageContext, buildDailyUsage, hasDailyActivity, localDayStarts, modelShare, type RawDailyUsage } from './daily-usage';

const day = (start: number, models: Record<string, number>, sessions: number, contextPeaks: number[]) => ({
  start,
  models: Object.entries(models).map(([model, tokens]) => ({ model, tokens })),
  sessions,
  contextPeaks,
});

describe('averageContext', () => {
  it('is the mean of the highest context each session reached, rounded', () => {
    expect(averageContext([100_000, 300_000])).toBe(200_000);
    expect(averageContext([1, 2])).toBe(2);
    expect(averageContext([412_000])).toBe(412_000);
  });

  it('is null when no session has a context that day', () => {
    expect(averageContext([])).toBeNull();
  });
});

describe('modelShare', () => {
  it('adds the tokens of each model over the days and orders by tokens', () => {
    const share = modelShare([
      { models: [{ model: 'opus', tokens: 60 }, { model: 'haiku', tokens: 10 }] },
      { models: [{ model: 'opus', tokens: 20 }, { model: 'sonnet', tokens: 10 }] },
    ]);
    expect(share.map((entry) => [entry.model, entry.tokens, entry.percent])).toEqual([
      ['opus', 80, 80],
      ['haiku', 10, 10],
      ['sonnet', 10, 10],
    ]);
    expect(share.reduce((total, entry) => total + entry.percent, 0)).toBeCloseTo(100);
  });

  it('breaks ties by name and drops models without tokens', () => {
    const share = modelShare([{ models: [{ model: 'b', tokens: 5 }, { model: 'a', tokens: 5 }, { model: 'c', tokens: 0 }] }]);
    expect(share.map((entry) => entry.model)).toEqual(['a', 'b']);
  });

  it('is empty when nothing was used', () => {
    expect(modelShare([])).toEqual([]);
    expect(modelShare([{ models: [] }, { models: [{ model: 'a', tokens: 0 }] }])).toEqual([]);
  });
});

describe('buildDailyUsage', () => {
  const raw: RawDailyUsage = {
    complete: true,
    days: [day(1_000, { opus: 10, haiku: 30 }, 2, [100, 300]), day(2_000, {}, 0, []), day(3_000, { opus: 60 }, 1, [500])],
  };

  it('puts the most recent day first and totals tokens per day and overall', () => {
    const usage = buildDailyUsage(raw);
    expect(usage.days.map((entry) => entry.start)).toEqual([3_000, 2_000, 1_000]);
    expect(usage.days.map((entry) => entry.totalTokens)).toEqual([60, 0, 40]);
    expect(usage.totalTokens).toBe(100);
  });

  it('orders the models of a day by tokens', () => {
    expect(buildDailyUsage(raw).days[2]?.models).toEqual([
      { model: 'haiku', tokens: 30 },
      { model: 'opus', tokens: 10 },
    ]);
  });

  it('an empty day has no models, no sessions and no average context', () => {
    expect(buildDailyUsage(raw).days[1]).toEqual({ start: 2_000, models: [], totalTokens: 0, sessions: 0, averageContext: null });
  });

  it('averages the context per day and splits the period by model', () => {
    const usage = buildDailyUsage(raw);
    expect(usage.days.map((entry) => entry.averageContext)).toEqual([500, null, 200]);
    expect(usage.modelShare.map((entry) => [entry.model, entry.percent])).toEqual([
      ['opus', 70],
      ['haiku', 30],
    ]);
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(raw);
    buildDailyUsage(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe('hasDailyActivity', () => {
  it('is false when every day is empty', () => {
    expect(hasDailyActivity(buildDailyUsage({ complete: true, days: [day(1, {}, 0, []), day(2, {}, 0, [])] }))).toBe(false);
  });

  it('is true when there are tokens or sessions', () => {
    expect(hasDailyActivity(buildDailyUsage({ complete: true, days: [day(1, { a: 1 }, 1, [1])] }))).toBe(true);
    expect(hasDailyActivity(buildDailyUsage({ complete: true, days: [day(1, {}, 1, [])] }))).toBe(true);
  });
});

describe('localDayStarts', () => {
  it('returns one boundary per day plus the end of today, all at local midnight and ascending', () => {
    const now = new Date(2026, 10, 13, 15, 30).getTime();
    const starts = localDayStarts(now, 7);
    expect(starts).toHaveLength(8);
    expect(starts.every((start) => new Date(start).getHours() === 0 && new Date(start).getMinutes() === 0)).toBe(true);
    expect(new Date(starts[0] ?? 0).getDate()).toBe(7);
    expect(new Date(starts[6] ?? 0).getDate()).toBe(13);
    expect(new Date(starts[7] ?? 0).getDate()).toBe(14);
    expect(starts.every((start, index) => index === 0 || start > (starts[index - 1] ?? 0))).toBe(true);
  });

  it('crosses month boundaries', () => {
    const starts = localDayStarts(new Date(2026, 10, 2, 1, 0).getTime(), 4);
    expect(starts.slice(0, 4).map((start) => new Date(start).getDate())).toEqual([30, 31, 1, 2]);
  });

  it('keeps now inside the last day just after midnight', () => {
    const now = new Date(2026, 10, 13, 0, 0, 1).getTime();
    const starts = localDayStarts(now, 3);
    expect(starts[2]).toBeLessThanOrEqual(now);
    expect(starts[3]).toBeGreaterThan(now);
  });
});
