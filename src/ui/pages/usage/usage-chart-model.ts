import {
  DEFAULT_USAGE_RANGE,
  dailyAverageForecast,
  isCycleAvailable,
  pointsInRange,
  projectionDays,
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
export const BASE_AXIS_MAX = 100;
export const MAX_AXIS_MAX = 300;
export const AXIS_STEP = 25;
const DAY_LABEL_MIN_GAP_MS = 0.6 * DAY_MS;

export type ChartPoint = [at: number, value: number];

export interface WindowInput {
  kind: UsageWindowKind;
  label: string;
  points: readonly UsagePoint[];
  forecast: Forecast;
  resetsAt: number | null;
}

export interface ProjectionMarker {
  at: number;
  value: number;
  tone: UsageTone;
  labeled: boolean;
}

export interface WindowSeries {
  kind: UsageWindowKind;
  label: string;
  points: ChartPoint[];
  trend: ChartPoint[] | null;
  days: ProjectionMarker[];
  trendTone: UsageTone;
  resetsAt: number | null;
}

export interface UsageChartModel {
  now: number;
  xMin: number;
  xMax: number;
  rangeMs: number;
  cycle: boolean;
  yMax: number;
  fiveHourResets: number[];
  windows: WindowSeries[];
}

function trendPoints(forecast: Forecast, xMax: number): ChartPoint[] | null {
  if (forecast.status !== 'ready') return null;
  const { trend } = forecast;
  const edgeAt = Math.min(trend.toAt, xMax);
  const edgeValue = trendValueAt(trend, edgeAt);
  const start: ChartPoint = [trend.fromAt, trend.fromValue];
  if (edgeValue <= MAX_AXIS_MAX) return [start, [edgeAt, edgeValue]];
  const crossAt = trend.fromAt + ((MAX_AXIS_MAX - trend.fromValue) * (trend.toAt - trend.fromAt)) / (trend.toValue - trend.fromValue);
  return [start, [Math.min(edgeAt, crossAt), MAX_AXIS_MAX]];
}

export function axisMaxFor(values: readonly number[]): number {
  const peak = Math.max(0, ...values);
  if (peak <= BASE_AXIS_MAX) return BASE_AXIS_MAX;
  return Math.min(MAX_AXIS_MAX, (Math.floor(peak / AXIS_STEP) + 1) * AXIS_STEP);
}

function projectionMarkers(forecast: Forecast, kind: UsageWindowKind, thresholds: UsageThresholds): ProjectionMarker[] {
  if (forecast.status !== 'ready') return [];
  const days = projectionDays(forecast.trend).filter((day) => day.value <= MAX_AXIS_MAX);
  return days.map((day, index) => ({
    at: day.at,
    value: day.value,
    tone: projectionTone(kind, day.value, thresholds),
    labeled: index === days.length - 1 || days[index + 1]!.at - day.at >= DAY_LABEL_MIN_GAP_MS,
  }));
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

function forecastFor(input: WindowInput, cycle: boolean, now: number): Forecast {
  if (!cycle) return input.forecast;
  if (input.kind === 'fiveHour') return { status: 'unavailable' };
  return dailyAverageForecast(input.points, now, input.resetsAt) ?? input.forecast;
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
  const windows = inputs.map((input): WindowSeries => {
    const forecast = forecastFor(input, cycle, now);
    return {
      kind: input.kind,
      label: input.label,
      points: (cycle
        ? input.points.filter((point) => point.at >= xMin && point.at <= now)
        : pointsInRange(input.points, effective, now)
      ).map((point): ChartPoint => [point.at, point.utilization]),
      trend: trendPoints(forecast, xMax),
      days: cycle && input.kind === 'sevenDay' ? projectionMarkers(forecast, input.kind, thresholds) : [],
      trendTone: trendToneOf(input.kind, forecast, thresholds),
      resetsAt: input.resetsAt,
    };
  });
  return {
    now,
    xMin,
    xMax,
    rangeMs: cycle ? CYCLE_MS : effective.durationMs,
    cycle,
    yMax: axisMaxFor(windows.flatMap((window) => window.trend?.map((point) => point[1]) ?? [])),
    fiveHourResets: cycle ? [...new Set([...pastFiveHourResets(fiveHour?.points ?? [], xMin, now), ...ahead])] : [],
    windows,
  };
}
