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
  it('soma os incrementos positivos e divide pelos dias cobertos', () => {
    expect(dailyConsumptionRate([point(4, 10), point(2, 30), point(0, 50)], NOW)).toBeCloseTo(10, 5);
  });

  it('quedas são resets e não contam', () => {
    const rate = dailyConsumptionRate([point(4, 10), point(3, 40), point(2, 5), point(0, 25)], NOW);
    expect(rate).toBeCloseTo((30 + 20) / 4, 5);
  });

  it('só olha os últimos 14 dias', () => {
    const rate = dailyConsumptionRate([point(20, 0), point(15, 90), point(4, 10), point(0, 50)], NOW);
    expect(rate).toBeCloseTo(40 / 4, 5);
  });

  it('o histórico importado conta', () => {
    expect(dailyConsumptionRate([point(3, 0, true), point(2, 10, true), point(0, 30)], NOW)).toBeCloseTo(10, 5);
  });

  it('menos de 1 dia de dados ou menos de 2 pontos não tem taxa', () => {
    expect(dailyConsumptionRate([], NOW)).toBeNull();
    expect(dailyConsumptionRate([point(0, 10)], NOW)).toBeNull();
    expect(dailyConsumptionRate([point(0.5, 10), point(0, 40)], NOW)).toBeNull();
    expect(dailyConsumptionRate([point(1, 10), point(0, 40)], NOW)).toBeCloseTo(30, 5);
  });

  it('ignora pontos no futuro', () => {
    expect(dailyConsumptionRate([point(2, 10), point(0, 30), point(-1, 99)], NOW)).toBeCloseTo(10, 5);
  });
});
