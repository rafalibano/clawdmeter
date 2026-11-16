import { describe, expect, it } from 'vitest';
import { DAILY_USAGE_DAYS, buildDailyUsage, hasDailyActivity, localDayStarts } from '../../domain/usage';
import { DemoDailyUsageReader } from './demo-daily-usage';

const NOW = new Date(2026, 10, 13, 15, 0).getTime();

describe('DemoDailyUsageReader', () => {
  it('returns one fake day per boundary pair, deterministic, with an idle day to exercise the empty state', async () => {
    const starts = localDayStarts(NOW, DAILY_USAGE_DAYS);
    const reader = new DemoDailyUsageReader();
    const first = await reader.read(starts);
    expect(first).toEqual(await reader.read(starts));
    expect(first.complete).toBe(true);
    expect(first.days.map((day) => day.start)).toEqual(starts.slice(0, -1));
    expect(first.days.some((day) => day.sessions === 0)).toBe(true);
    const usage = buildDailyUsage(first);
    expect(hasDailyActivity(usage)).toBe(true);
    expect(usage.days[0]?.totalTokens).toBeGreaterThan(0);
    expect(usage.modelShare.length).toBeGreaterThan(1);
  });
});
