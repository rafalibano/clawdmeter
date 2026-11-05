import {
  EXHAUSTION_LEVEL,
  pointsInRange,
  trendValueAt,
  type Forecast,
  type UsagePoint,
  type UsageRange,
  type UsageWindowKind,
} from '../../../domain/usage';

export const FUTURE_SHARE = 0.15;

export type ChartPoint = [at: number, value: number];

export interface WindowInput {
  kind: UsageWindowKind;
  label: string;
  points: readonly UsagePoint[];
  forecast: Forecast;
  resetsAt: number | null;
}

export interface WindowSeries {
  kind: UsageWindowKind;
  label: string;
  points: ChartPoint[];
  trend: ChartPoint[] | null;
  resetsAt: number | null;
}

export interface UsageChartModel {
  now: number;
  xMin: number;
  xMax: number;
  rangeMs: number;
  windows: WindowSeries[];
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

export function buildChartModel(inputs: readonly WindowInput[], range: UsageRange, now: number): UsageChartModel {
  const xMax = now + range.durationMs * FUTURE_SHARE;
  return {
    now,
    xMin: now - range.durationMs,
    xMax,
    rangeMs: range.durationMs,
    windows: inputs.map((input) => ({
      kind: input.kind,
      label: input.label,
      points: pointsInRange(input.points, range, now).map((point): ChartPoint => [point.at, point.utilization]),
      trend: trendPoints(input.forecast, xMax),
      resetsAt: input.resetsAt,
    })),
  };
}
