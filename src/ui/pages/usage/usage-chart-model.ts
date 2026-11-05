import {
  EXHAUSTION_LEVEL,
  pointsInRange,
  trendValueAt,
  type Forecast,
  type UsagePoint,
  type UsageRange,
} from '../../../domain/usage';

export const FUTURE_SHARE = 0.15;

export type ChartPoint = [at: number, value: number];

export interface UsageChartModel {
  now: number;
  xMin: number;
  xMax: number;
  rangeMs: number;
  series: ChartPoint[];
  trend: ChartPoint[] | null;
}

function trendPoints(forecast: Forecast, xMax: number): ChartPoint[] | null {
  if (forecast.status !== 'ready') return null;
  const { trend, exhaustsAt } = forecast;
  const capped = exhaustsAt !== null && exhaustsAt < xMax;
  const endAt = Math.min(trend.toAt, capped ? exhaustsAt : xMax);
  const endValue = capped && endAt === exhaustsAt ? EXHAUSTION_LEVEL : trendValueAt(trend, endAt);
  return [
    [trend.fromAt, trend.fromValue],
    [endAt, endValue],
  ];
}

export function buildChartModel(
  points: readonly UsagePoint[],
  forecast: Forecast,
  range: UsageRange,
  now: number,
): UsageChartModel {
  const xMax = now + range.durationMs * FUTURE_SHARE;
  return {
    now,
    xMin: now - range.durationMs,
    xMax,
    rangeMs: range.durationMs,
    series: pointsInRange(points, range, now).map((point) => [point.at, point.utilization]),
    trend: trendPoints(forecast, xMax),
  };
}
