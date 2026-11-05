import { MINUTE_MS } from '../time';
import { linearRegression } from './regression';
import type { UsageHistory, UsagePoint } from './usage-history';
import type { UsageSnapshot } from './usage-snapshot';
import { USAGE_WINDOWS, usageWindow, type UsageWindowKind } from './usage-window';

export const MIN_FORECAST_POINTS = 3;
export const EXHAUSTION_LEVEL = 100;
const RESET_AT_TOLERANCE_MS = 5 * MINUTE_MS;
const RESET_DROP_TOLERANCE = 1;

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
      valueAtReset: number;
      trend: TrendLine;
      exhaustsAt: number | null;
      exhaustsLeadMs: number | null;
    };

export type UsageForecasts = Record<UsageWindowKind, Forecast>;

function startsNewCycle(previous: UsagePoint, next: UsagePoint): boolean {
  if (next.utilization < previous.utilization - RESET_DROP_TOLERANCE) return true;
  if (previous.imported || next.imported) return false;
  if (previous.resetsAt === null || next.resetsAt === null) return previous.resetsAt !== next.resetsAt;
  return Math.abs(next.resetsAt - previous.resetsAt) > RESET_AT_TOLERANCE_MS;
}

export function currentCycle(points: readonly UsagePoint[]): UsagePoint[] {
  let start = 0;
  for (let index = 1; index < points.length; index++) {
    if (startsNewCycle(points[index - 1]!, points[index]!)) start = index;
  }
  return points.slice(start);
}

export function forecastWindow(
  kind: UsageWindowKind,
  points: readonly UsagePoint[],
  now: number,
  resetsAt: number | null,
): Forecast {
  const observed = currentCycle(points.filter((point) => point.at <= now));
  const last = observed[observed.length - 1];
  if (last === undefined) return { status: 'collecting' };
  if (resetsAt === null || resetsAt <= last.at) return { status: 'unavailable' };

  const from = now - usageWindow(kind).regressionWindowMs;
  const recent = observed.filter((point) => point.at >= from);
  if (recent.length < MIN_FORECAST_POINTS) return { status: 'collecting' };

  const origin = recent[0]!.at;
  const line = linearRegression(recent.map((point) => ({ x: (point.at - origin) / MINUTE_MS, y: point.utilization })));
  if (line === null) return { status: 'collecting' };

  const slopePerMs = Math.max(0, line.slope) / MINUTE_MS;
  const valueAtReset = last.utilization + slopePerMs * (resetsAt - last.at);
  const exhausts = last.utilization < EXHAUSTION_LEVEL && slopePerMs > 0 && valueAtReset >= EXHAUSTION_LEVEL;
  const exhaustsAt = exhausts ? last.at + (EXHAUSTION_LEVEL - last.utilization) / slopePerMs : null;

  return {
    status: 'ready',
    resetsAt,
    valueAtReset,
    trend: { fromAt: last.at, fromValue: last.utilization, toAt: resetsAt, toValue: valueAtReset },
    exhaustsAt,
    exhaustsLeadMs: exhaustsAt === null ? null : resetsAt - exhaustsAt,
  };
}

export function trendValueAt(trend: TrendLine, at: number): number {
  const span = trend.toAt - trend.fromAt;
  if (span <= 0) return trend.fromValue;
  return trend.fromValue + ((trend.toValue - trend.fromValue) * (at - trend.fromAt)) / span;
}

export function buildForecasts(history: UsageHistory, snapshot: UsageSnapshot, now: number): UsageForecasts {
  const forecasts = {} as UsageForecasts;
  for (const { kind } of USAGE_WINDOWS) {
    forecasts[kind] = forecastWindow(kind, history[kind], now, snapshot[kind]?.resetsAt ?? null);
  }
  return forecasts;
}
