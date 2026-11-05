import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../time';
import { dailyConsumptionRate } from './consumption-rate';
import type { UsagePoint } from './usage-history';

const NOW = new Date(2026, 10, 5, 15, 0).getTime();
const point = (daysAgo: number, utilization: number, imported = false): UsagePoint => ({
  at: NOW - daysAgo * DAY_MS,
  utilization,
  resetsAt: null,
  ...(imported ? { imported: true as const } : {}),
});

describe('dailyConsumptionRate', () => {
  it('sums the positive increments and divides by the covered days', () => {
    expect(dailyConsumptionRate([point(4, 10), point(2, 30), point(0, 50)], NOW)).toBeCloseTo(10, 5);
  });

  it('drops are resets and do not count', () => {
    const rate = dailyConsumptionRate([point(4, 10), point(3, 40), point(2, 5), point(0, 25)], NOW);
    expect(rate).toBeCloseTo((30 + 20) / 4, 5);
  });

  it('only looks at the last 14 days', () => {
    const rate = dailyConsumptionRate([point(20, 0), point(15, 90), point(4, 10), point(0, 50)], NOW);
    expect(rate).toBeCloseTo(40 / 4, 5);
  });

  it('imported history counts', () => {
    expect(dailyConsumptionRate([point(3, 0, true), point(2, 10, true), point(0, 30)], NOW)).toBeCloseTo(10, 5);
  });

  it('less than 1 day of data or fewer than 2 points has no rate', () => {
    expect(dailyConsumptionRate([], NOW)).toBeNull();
    expect(dailyConsumptionRate([point(0, 10)], NOW)).toBeNull();
    expect(dailyConsumptionRate([point(0.5, 10), point(0, 40)], NOW)).toBeNull();
    expect(dailyConsumptionRate([point(1, 10), point(0, 40)], NOW)).toBeCloseTo(30, 5);
  });

  it('ignores points in the future', () => {
    expect(dailyConsumptionRate([point(2, 10), point(0, 30), point(-1, 99)], NOW)).toBeCloseTo(10, 5);
  });
});
