import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from '../time';
import {
  dailyAverageForecast,
  dailyConsumptionRate,
  localMidnightsBetween,
  projectionDays,
} from './daily-average';
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

describe('dailyAverageForecast', () => {
  const history = [point(4, 10), point(2, 30), point(0, 50)];

  it('projeta atual + taxa × dias até o reset', () => {
    const resetsAt = NOW + 3 * DAY_MS;
    const forecast = dailyAverageForecast(history, NOW, resetsAt);
    expect(forecast).toMatchObject({ status: 'ready', resetsAt, exhaustsAt: null });
    if (forecast?.status !== 'ready') throw new Error('esperava previsão');
    expect(forecast.valueAtReset).toBeCloseTo(50 + 10 * 3, 5);
    expect(forecast.trend).toMatchObject({ fromAt: NOW, fromValue: 50, toAt: resetsAt });
  });

  it('estima o momento em que passa de 100%', () => {
    const forecast = dailyAverageForecast(history, NOW, NOW + 7 * DAY_MS);
    if (forecast?.status !== 'ready') throw new Error('esperava previsão');
    expect(forecast.exhaustsAt).toBeCloseTo(NOW + 5 * DAY_MS, -2);
    expect(forecast.exhaustsLeadMs).toBeCloseTo(2 * DAY_MS, -2);
  });

  it('sem dados suficientes ou sem reset futuro devolve null', () => {
    expect(dailyAverageForecast([point(0.5, 10), point(0, 40)], NOW, NOW + DAY_MS)).toBeNull();
    expect(dailyAverageForecast(history, NOW, null)).toBeNull();
    expect(dailyAverageForecast(history, NOW, NOW)).toBeNull();
  });

  it('consumo parado projeta uma linha plana', () => {
    const flat = dailyAverageForecast([point(3, 20), point(0, 20)], NOW, NOW + 2 * DAY_MS);
    if (flat?.status !== 'ready') throw new Error('esperava previsão');
    expect(flat.valueAtReset).toBe(20);
  });
});

describe('fronteiras de dia', () => {
  it('lista as 00:00 do fuso local entre agora e o reset, sem repetir o reset', () => {
    const resetsAt = new Date(2026, 10, 9, 10, 0).getTime();
    const midnights = localMidnightsBetween(NOW, resetsAt);
    expect(midnights.map((at) => new Date(at).getDate())).toEqual([6, 7, 8, 9]);
    expect(midnights.every((at) => new Date(at).getHours() === 0 && new Date(at).getMinutes() === 0)).toBe(true);
    const atMidnight = new Date(2026, 10, 9, 0, 0).getTime();
    expect(localMidnightsBetween(NOW, atMidnight).map((at) => new Date(at).getDate())).toEqual([6, 7, 8]);
  });

  it('projectionDays traz um ponto por fronteira e o ponto final no reset', () => {
    const resetsAt = new Date(2026, 10, 8, 12, 0).getTime();
    const days = projectionDays({ fromAt: NOW, fromValue: 40, toAt: resetsAt, toValue: 40 + (resetsAt - NOW) / HOUR_MS });
    expect(days.map((day) => day.at)).toEqual([
      new Date(2026, 10, 6).getTime(),
      new Date(2026, 10, 7).getTime(),
      new Date(2026, 10, 8).getTime(),
      resetsAt,
    ]);
    expect(days[0]!.value).toBeCloseTo(40 + 9, 5);
    expect(days[3]!.value).toBeCloseTo(40 + (resetsAt - NOW) / HOUR_MS, 5);
  });
});
