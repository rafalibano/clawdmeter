import { DAY_MS, HOUR_MS } from '../time';
import type { UsagePoint } from './usage-history';

export interface RateWindow {
  windowMs: number;
  minSpanMs: number;
  calendarDays?: number;
}

export const RATE_WINDOW_24H: RateWindow = { windowMs: DAY_MS, minSpanMs: 2 * HOUR_MS };
export const RATE_WINDOW_7D: RateWindow = { windowMs: 7 * DAY_MS, minSpanMs: DAY_MS, calendarDays: 7 };
export const RATE_WINDOW_14D: RateWindow = { windowMs: 14 * DAY_MS, minSpanMs: DAY_MS };

export function dailyConsumptionRate(
  points: readonly UsagePoint[],
  now: number,
  { windowMs, minSpanMs, calendarDays }: RateWindow = RATE_WINDOW_14D,
): number | null {
  const from = now - windowMs;
  const window = points.filter((point) => point.at >= from && point.at <= now);
  const first = window[0];
  const last = window[window.length - 1];
  if (first === undefined || last === undefined) return null;
  const span = last.at - first.at;
  if (span < minSpanMs) return null;
  let consumed = 0;
  for (let index = 1; index < window.length; index++) {
    const increment = window[index]!.utilization - window[index - 1]!.utilization;
    if (increment > 0) consumed += increment;
  }
  return consumed / (calendarDays ?? span / DAY_MS);
}
