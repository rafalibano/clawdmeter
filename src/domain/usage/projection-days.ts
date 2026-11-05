import { DAY_MS } from '../time';
import { EXHAUSTION_LEVEL, trendValueAt, type Forecast, type TrendLine } from './forecast';
import type { UsagePoint } from './usage-history';

export const DAILY_AVERAGE_WINDOW_MS = 14 * DAY_MS;
export const MIN_DAILY_AVERAGE_SPAN_MS = DAY_MS;

export interface ProjectionDay {
  at: number;
  value: number;
}

export function dailyConsumptionRate(points: readonly UsagePoint[], now: number): number | null {
  const from = now - DAILY_AVERAGE_WINDOW_MS;
  const window = points.filter((point) => point.at >= from && point.at <= now);
  const first = window[0];
  const last = window[window.length - 1];
  if (first === undefined || last === undefined) return null;
  const span = last.at - first.at;
  if (span < MIN_DAILY_AVERAGE_SPAN_MS) return null;
  let consumed = 0;
  for (let index = 1; index < window.length; index++) {
    const increment = window[index]!.utilization - window[index - 1]!.utilization;
    if (increment > 0) consumed += increment;
  }
  return consumed / (span / DAY_MS);
}

export function dailyAverageForecast(points: readonly UsagePoint[], now: number, resetsAt: number | null): Forecast | null {
  if (resetsAt === null || resetsAt <= now) return null;
  const rate = dailyConsumptionRate(points, now);
  if (rate === null) return null;
  const current = points.filter((point) => point.at <= now).at(-1)!.utilization;
  const valueAtReset = current + (rate * (resetsAt - now)) / DAY_MS;
  const exhausts = current < EXHAUSTION_LEVEL && rate > 0 && valueAtReset >= EXHAUSTION_LEVEL;
  const exhaustsAt = exhausts ? now + ((EXHAUSTION_LEVEL - current) / rate) * DAY_MS : null;
  return {
    status: 'ready',
    resetsAt,
    valueAtReset,
    trend: { fromAt: now, fromValue: current, toAt: resetsAt, toValue: valueAtReset },
    exhaustsAt,
    exhaustsLeadMs: exhaustsAt === null ? null : resetsAt - exhaustsAt,
  };
}

export function localMidnightsBetween(from: number, to: number): number[] {
  const midnights: number[] = [];
  const cursor = new Date(from);
  cursor.setHours(24, 0, 0, 0);
  while (cursor.getTime() < to) {
    midnights.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return midnights;
}

export function projectionDays(trend: TrendLine): ProjectionDay[] {
  return [...localMidnightsBetween(trend.fromAt, trend.toAt), trend.toAt].map((at) => ({
    at,
    value: trendValueAt(trend, at),
  }));
}
