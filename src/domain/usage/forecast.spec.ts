import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../time';
import { buildForecasts, forecastWindow, trendValueAt, type Forecast } from './forecast';
import { createEmptyHistory, type UsagePoint } from './usage-history';

const NOW = new Date(2026, 10, 5, 15, 0).getTime();
const WEEKLY_RESET = NOW + 3 * DAY_MS;
const FIVE_RESET = NOW + 2 * HOUR_MS;

const point = (daysAgo: number, utilization: number, imported = false): UsagePoint => ({
  at: NOW - daysAgo * DAY_MS,
  utilization,
  resetsAt: null,
  ...(imported ? { imported: true as const } : {}),
});

function ready(forecast: Forecast) {
  if (forecast.status !== 'ready') throw new Error(`esperava ready, veio ${forecast.status}`);
  return forecast;
}

describe('14d method (sevenDay)', () => {
  const points = [point(4, 10), point(2, 30), point(0, 50)];

  it('rate = positive increments ÷ covered days; projected = current + rate × days until the reset', () => {
    const forecast = ready(forecastWindow('sevenDay', '14d', points, NOW, 50, WEEKLY_RESET));
    expect(forecast.valueAtReset).toBeCloseTo(50 + 10 * 3, 5);
    expect(forecast.trend).toEqual({ fromAt: NOW, fromValue: 50, toAt: WEEKLY_RESET, toValue: forecast.valueAtReset });
  });

  it('drops (reset) are ignored in the sum', () => {
    const withDrop = [point(4, 10), point(3, 40), point(2, 5), point(0, 25)];
    const forecast = ready(forecastWindow('sevenDay', '14d', withDrop, NOW, 25, WEEKLY_RESET));
    expect(forecast.valueAtReset).toBeCloseTo(25 + ((30 + 20) / 4) * 3, 5);
  });

  it('only considers the last 14 days', () => {
    const old = [point(20, 0), point(15, 90), point(4, 10), point(0, 50)];
    const forecast = ready(forecastWindow('sevenDay', '14d', old, NOW, 50, WEEKLY_RESET));
    expect(forecast.valueAtReset).toBeCloseTo(50 + 10 * 3, 5);
  });

  it('imported history counts', () => {
    const imported = [point(3, 0, true), point(2, 10, true), point(0, 30)];
    const forecast = ready(forecastWindow('sevenDay', '14d', imported, NOW, 30, WEEKLY_RESET));
    expect(forecast.valueAtReset).toBeCloseTo(30 + 10 * 3, 5);
  });

  it('reports the moment it goes past 100%', () => {
    const forecast = ready(forecastWindow('sevenDay', '14d', points, NOW, 50, NOW + 7 * DAY_MS));
    expect(forecast.exhaustsAt).toBeCloseTo(NOW + 5 * DAY_MS, -2);
    expect(forecast.exhaustsLeadMs).toBeCloseTo(2 * DAY_MS, -2);
  });

  it('flat consumption projects a flat line, without overflow', () => {
    const forecast = ready(forecastWindow('sevenDay', '14d', [point(3, 20), point(0, 20)], NOW, 20, WEEKLY_RESET));
    expect(forecast.valueAtReset).toBe(20);
    expect(forecast.exhaustsAt).toBeNull();
  });

  it('less than 1 day of data falls back to consumption since the reset', () => {
    const resetsAt = NOW + 3 * DAY_MS;
    const elapsed = 4 * DAY_MS;
    const short = [point(0.5, 10), point(0, 40)];
    const forecast = ready(forecastWindow('sevenDay', '14d', short, NOW, 40, resetsAt));
    expect(forecast.valueAtReset).toBeCloseTo(40 + (40 / elapsed) * 3 * DAY_MS, 5);
  });

  it('without points and insufficient data still falls back to since-reset when time has elapsed', () => {
    const forecast = ready(forecastWindow('sevenDay', '14d', [], NOW, 35, WEEKLY_RESET));
    expect(forecast.valueAtReset).toBeCloseTo(35 + (35 / (4 * DAY_MS)) * 3 * DAY_MS, 5);
  });
});

describe('24h method (sevenDay)', () => {
  const hourAgo = (hours: number, utilization: number): UsagePoint => ({ at: NOW - hours * HOUR_MS, utilization, resetsAt: null });

  it('rate = positive increments from the last 24h ÷ covered hours, drops ignored', () => {
    const points = [hourAgo(30, 90), hourAgo(20, 10), hourAgo(12, 30), hourAgo(10, 4), hourAgo(0, 24)];
    const forecast = ready(forecastWindow('sevenDay', '24h', points, NOW, 24, WEEKLY_RESET));
    expect(forecast.ratePerDay).toBeCloseTo(((20 + 20) / 20) * 24, 5);
    expect(forecast.valueAtReset).toBeCloseTo(24 + ((40 / 20) * 24) * 3, 5);
  });

  it('only looks at the last 24h, unlike 14d', () => {
    const points = [point(5, 0), point(4, 50), hourAgo(10, 50), hourAgo(0, 55)];
    const by24 = ready(forecastWindow('sevenDay', '24h', points, NOW, 55, WEEKLY_RESET));
    const by14 = ready(forecastWindow('sevenDay', '14d', points, NOW, 55, WEEKLY_RESET));
    expect(by24.ratePerDay).toBeCloseTo((5 / 10) * 24, 5);
    expect(by14.ratePerDay).not.toBeCloseTo(by24.ratePerDay, 3);
  });

  it('less than 2h of data falls back to consumption since the reset', () => {
    const points = [hourAgo(1.5, 10), hourAgo(0, 20)];
    const forecast = ready(forecastWindow('sevenDay', '24h', points, NOW, 20, WEEKLY_RESET));
    expect(forecast.valueAtReset).toBeCloseTo(20 + (20 / (4 * DAY_MS)) * 3 * DAY_MS, 5);
  });

  it('exactly 2h of data is enough', () => {
    const points = [hourAgo(2, 10), hourAgo(0, 20)];
    expect(ready(forecastWindow('sevenDay', '24h', points, NOW, 20, WEEKLY_RESET)).ratePerDay).toBeCloseTo(5 * 24, 5);
  });
});

describe('since-reset method', () => {
  it('rate = current % ÷ time since the last reset; ignores the history', () => {
    const history = [point(4, 10), point(2, 30), point(0, 50)];
    const forecast = ready(forecastWindow('sevenDay', 'since-reset', history, NOW, 50, WEEKLY_RESET));
    expect(forecast.valueAtReset).toBeCloseTo(50 + (50 / (4 * DAY_MS)) * 3 * DAY_MS, 5);
  });

  it('elapsed under 30 min: no projection', () => {
    const resetsAt = NOW + 7 * DAY_MS - 29 * MINUTE_MS;
    expect(forecastWindow('sevenDay', 'since-reset', [], NOW, 2, resetsAt)).toEqual({ status: 'collecting' });
    expect(forecastWindow('sevenDay', '14d', [], NOW, 2, resetsAt)).toEqual({ status: 'collecting' });
  });

  it('exactly 30 min already projects', () => {
    const resetsAt = NOW + 7 * DAY_MS - 30 * MINUTE_MS;
    expect(forecastWindow('sevenDay', 'since-reset', [], NOW, 2, resetsAt).status).toBe('ready');
  });
});

describe('5h window', () => {
  const FIVE_START = FIVE_RESET - 5 * HOUR_MS;
  const history = [point(4, 10), point(2, 30), point(0, 50)];

  it('always uses consumption since the 5h reset, in both methods', () => {
    const elapsed = NOW - FIVE_START;
    const expected = 40 + (40 / elapsed) * 2 * HOUR_MS;
    for (const method of ['14d', 'since-reset'] as const) {
      expect(ready(forecastWindow('fiveHour', method, history, NOW, 40, FIVE_RESET)).valueAtReset).toBeCloseTo(expected, 5);
    }
  });

  it('does not project in the first 30 min after the reset', () => {
    const resetsAt = NOW + 5 * HOUR_MS - 10 * MINUTE_MS;
    expect(forecastWindow('fiveHour', '14d', history, NOW, 3, resetsAt)).toEqual({ status: 'collecting' });
  });
});

describe('states', () => {
  it('without a current reading: collecting', () => {
    expect(forecastWindow('sevenDay', '14d', [], NOW, null, WEEKLY_RESET)).toEqual({ status: 'collecting' });
  });

  it('without resets_at or reset in the past: unavailable', () => {
    expect(forecastWindow('sevenDay', '14d', [], NOW, 10, null)).toEqual({ status: 'unavailable' });
    expect(forecastWindow('sevenDay', 'since-reset', [], NOW, 10, NOW)).toEqual({ status: 'unavailable' });
  });

  it('already at 100%: no overflow time', () => {
    const forecast = ready(forecastWindow('sevenDay', 'since-reset', [], NOW, 100, WEEKLY_RESET));
    expect(forecast.exhaustsAt).toBeNull();
    expect(forecast.valueAtReset).toBeGreaterThan(100);
  });
});

describe('trendValueAt', () => {
  it('interpolates between the last point and the reset', () => {
    const trend = { fromAt: 0, fromValue: 10, toAt: 100, toValue: 50 };
    expect(trendValueAt(trend, 50)).toBe(30);
    expect(trendValueAt({ ...trend, toAt: 0 }, 50)).toBe(10);
  });
});

describe('buildForecasts', () => {
  const snapshot = {
    fiveHour: { utilization: 40, resetsAt: FIVE_RESET },
    sevenDay: { utilization: 50, resetsAt: WEEKLY_RESET },
  };
  const history = { ...createEmptyHistory(), sevenDay: [point(4, 10), point(2, 30), point(0, 50)] };

  it('the method only changes the 7d; the 5h is the same in all three', () => {
    const byDays = buildForecasts(history, snapshot, NOW, '14d');
    const bySince = buildForecasts(history, snapshot, NOW, 'since-reset');
    expect(ready(byDays.sevenDay).valueAtReset).toBeCloseTo(80, 5);
    expect(ready(bySince.sevenDay).valueAtReset).not.toBeCloseTo(80, 1);
    expect(byDays.fiveHour).toEqual(bySince.fiveHour);
  });

  it('a window missing from the snapshot stays collecting', () => {
    const forecasts = buildForecasts(history, { ...snapshot, sevenDay: null }, NOW, '14d');
    expect(forecasts.sevenDay).toEqual({ status: 'collecting' });
  });
});
