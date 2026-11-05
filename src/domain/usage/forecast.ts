import { DAY_MS, MINUTE_MS } from '../time';
import { RATE_WINDOW_14D, RATE_WINDOW_24H, RATE_WINDOW_7D, dailyConsumptionRate, type RateWindow } from './consumption-rate';
import type { ProjectionMethod } from './projection-method';
import type { UsageHistory, UsagePoint } from './usage-history';
import type { UsageSnapshot } from './usage-snapshot';
import { USAGE_WINDOWS, usageWindow, type UsageWindowKind } from './usage-window';

export const EXHAUSTION_LEVEL = 100;
export const MIN_ELAPSED_MS = 30 * MINUTE_MS;

export interface TrendLine {
  fromAt: number;
  fromValue: number;
  toAt: number;
  toValue: number;
}

export type Forecast =
  | { status: 'collecting' }
  | { status: 'unavailable' }
  | {
      status: 'ready';
      resetsAt: number;
      ratePerDay: number;
      valueAtReset: number;
      trend: TrendLine;
      exhaustsAt: number | null;
      exhaustsLeadMs: number | null;
    };

export type UsageForecasts = Record<UsageWindowKind, Forecast>;

const RATE_WINDOWS: Record<Exclude<ProjectionMethod, 'since-reset'>, RateWindow> = {
  '24h': RATE_WINDOW_24H,
  '7d': RATE_WINDOW_7D,
  '14d': RATE_WINDOW_14D,
};

function ready(current: number, ratePerMs: number, now: number, resetsAt: number): Forecast {
  const valueAtReset = current + ratePerMs * (resetsAt - now);
  const exhausts = current < EXHAUSTION_LEVEL && ratePerMs > 0 && valueAtReset >= EXHAUSTION_LEVEL;
  const exhaustsAt = exhausts ? now + (EXHAUSTION_LEVEL - current) / ratePerMs : null;
  return {
    status: 'ready',
    resetsAt,
    ratePerDay: ratePerMs * DAY_MS,
    valueAtReset,
    trend: { fromAt: now, fromValue: current, toAt: resetsAt, toValue: valueAtReset },
    exhaustsAt,
    exhaustsLeadMs: exhaustsAt === null ? null : resetsAt - exhaustsAt,
  };
}

function sinceReset(kind: UsageWindowKind, current: number, now: number, resetsAt: number): Forecast {
  const elapsed = now - (resetsAt - usageWindow(kind).durationMs);
  if (elapsed < MIN_ELAPSED_MS) return { status: 'collecting' };
  return ready(current, current / elapsed, now, resetsAt);
}

export function forecastWindow(
  kind: UsageWindowKind,
  method: ProjectionMethod,
  points: readonly UsagePoint[],
  now: number,
  current: number | null,
  resetsAt: number | null,
): Forecast {
  if (current === null) return { status: 'collecting' };
  if (resetsAt === null || resetsAt <= now) return { status: 'unavailable' };
  if (kind === 'sevenDay' && method !== 'since-reset') {
    const rate = dailyConsumptionRate(points, now, RATE_WINDOWS[method]);
    if (rate !== null) return ready(current, rate / DAY_MS, now, resetsAt);
  }
  return sinceReset(kind, current, now, resetsAt);
}

export function trendValueAt(trend: TrendLine, at: number): number {
  const span = trend.toAt - trend.fromAt;
  if (span <= 0) return trend.fromValue;
  return trend.fromValue + ((trend.toValue - trend.fromValue) * (at - trend.fromAt)) / span;
}

export function buildForecasts(
  history: UsageHistory,
  snapshot: UsageSnapshot,
  now: number,
  method: ProjectionMethod,
): UsageForecasts {
  const forecasts = {} as UsageForecasts;
  for (const { kind } of USAGE_WINDOWS) {
    const reading = snapshot[kind];
    forecasts[kind] = forecastWindow(kind, method, history[kind], now, reading?.utilization ?? null, reading?.resetsAt ?? null);
  }
  return forecasts;
}
