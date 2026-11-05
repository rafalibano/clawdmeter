import {
  DEFAULT_USAGE_RANGE,
  EXHAUSTION_LEVEL,
  isCycleAvailable,
  pointsInRange,
  trendValueAt,
  usageRange,
  type Forecast,
  type UsagePoint,
  type UsageRange,
  type UsageWindowKind,
} from '../../../domain/usage';
import { DAY_MS, MINUTE_MS } from '../../../domain/time';
import type { UsageThresholds } from '../../../domain/settings';
import { projectionTone, type UsageTone } from './usage-tone';

export const FUTURE_SHARE = 0.15;
export const CYCLE_MS = 7 * DAY_MS;

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
  trendTone: UsageTone;
  resetsAt: number | null;
}

export interface UsageChartModel {
  now: number;
  xMin: number;
  xMax: number;
  rangeMs: number;
  cycle: boolean;
  fiveHourResets: number[];
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

function trendToneOf(kind: UsageWindowKind, forecast: Forecast, thresholds: UsageThresholds): UsageTone {
  return forecast.status === 'ready' ? projectionTone(kind, forecast.valueAtReset, thresholds) : 'base';
}

function pastFiveHourResets(points: readonly UsagePoint[], xMin: number, xMax: number): number[] {
  const seen = new Map<number, number>();
  for (const point of points) {
    if (point.resetsAt === null || point.resetsAt < xMin || point.resetsAt > xMax) continue;
    seen.set(Math.round(point.resetsAt / (5 * MINUTE_MS)), point.resetsAt);
  }
  return [...seen.values()].sort((a, b) => a - b);
}

export function buildChartModel(
  inputs: readonly WindowInput[],
  range: UsageRange,
  now: number,
  thresholds: UsageThresholds,
): UsageChartModel {
  const weeklyResetsAt = inputs.find((input) => input.kind === 'sevenDay')?.resetsAt ?? null;
  const cycle = range.cycle === true && isCycleAvailable(weeklyResetsAt, now);
  const effective = range.cycle === true && !cycle ? usageRange(DEFAULT_USAGE_RANGE) : range;
  const xMax = cycle ? (weeklyResetsAt as number) : now + effective.durationMs * FUTURE_SHARE;
  const xMin = cycle ? xMax - CYCLE_MS : now - effective.durationMs;
  const fiveHour = inputs.find((input) => input.kind === 'fiveHour');
  const ahead = fiveHour?.resetsAt != null && fiveHour.resetsAt > now && fiveHour.resetsAt <= xMax ? [fiveHour.resetsAt] : [];
  return {
    now,
    xMin,
    xMax,
    rangeMs: cycle ? CYCLE_MS : effective.durationMs,
    cycle,
    fiveHourResets: cycle ? [...new Set([...pastFiveHourResets(fiveHour?.points ?? [], xMin, now), ...ahead])] : [],
    windows: inputs.map((input) => ({
      kind: input.kind,
      label: input.label,
      points: (cycle
        ? input.points.filter((point) => point.at >= xMin && point.at <= now)
        : pointsInRange(input.points, effective, now)
      ).map((point): ChartPoint => [point.at, point.utilization]),
      trend: trendPoints(input.forecast, xMax),
      trendTone: trendToneOf(input.kind, input.forecast, thresholds),
      resetsAt: input.resetsAt,
    })),
  };
}
