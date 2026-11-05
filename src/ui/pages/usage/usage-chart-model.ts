import {
  DEFAULT_USAGE_RANGE,
  dailyAverageForecast,
  isCycleAvailable,
  pointsInRange,
  trendValueAt,
  usageRange,
  type Forecast,
  type UsagePoint,
  type UsageRange,
  type UsageWindowKind,
} from '../../../domain/usage';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { RAW_RETENTION_MS } from '../../../domain/usage/retention';

export const FUTURE_SHARE = 0.15;
export const CYCLE_MS = 7 * DAY_MS;
export const BASE_AXIS_MAX = 100;
export const MAX_AXIS_MAX = 300;
export const AXIS_STEP = 25;

export type ChartPoint = [at: number, value: number];
export type SeriesPoint = [at: number, value: number | null];

export const RAW_GAP_MS = 30 * MINUTE_MS;
export const AGGREGATED_GAP_MS = HOUR_MS;
export const FIVE_HOUR_PROJECTION_MAX_MS = DAY_MS;

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
  points: SeriesPoint[];
  trend: ChartPoint[] | null;
  projectAt: ((at: number) => number) | null;
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

function trendPoints(forecast: Forecast, xMax: number, cap: number): ChartPoint[] | null {
  if (forecast.status !== 'ready') return null;
  const { trend } = forecast;
  const edgeAt = Math.min(trend.toAt, xMax);
  const edgeValue = trendValueAt(trend, edgeAt);
  const start: ChartPoint = [trend.fromAt, trend.fromValue];
  if (edgeValue <= cap) return [start, [edgeAt, edgeValue]];
  const crossAt = trend.fromAt + ((cap - trend.fromValue) * (trend.toAt - trend.fromAt)) / (trend.toValue - trend.fromValue);
  return [start, [Math.min(edgeAt, crossAt), cap]];
}

export function axisMaxFor(values: readonly number[]): number {
  const peak = Math.max(0, ...values);
  if (peak <= BASE_AXIS_MAX) return BASE_AXIS_MAX;
  return Math.min(MAX_AXIS_MAX, (Math.floor(peak / AXIS_STEP) + 1) * AXIS_STEP);
}

export function projector(forecast: Forecast): ((at: number) => number) | null {
  if (forecast.status !== 'ready') return null;
  const { trend } = forecast;
  return (at) => trendValueAt(trend, at);
}

export function withGaps(points: readonly ChartPoint[], now: number): SeriesPoint[] {
  const result: SeriesPoint[] = [];
  const rawFrom = now - RAW_RETENTION_MS;
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (previous !== undefined) {
      const limit = previous[0] < rawFrom ? AGGREGATED_GAP_MS : RAW_GAP_MS;
      if (point[0] - previous[0] > limit) result.push([previous[0] + 1, null]);
    }
    result.push(point);
  });
  return result;
}

function pastFiveHourResets(points: readonly UsagePoint[], xMin: number, xMax: number): number[] {
  const seen = new Map<number, number>();
  for (const point of points) {
    if (point.resetsAt === null || point.resetsAt < xMin || point.resetsAt > xMax) continue;
    seen.set(Math.round(point.resetsAt / (5 * MINUTE_MS)), point.resetsAt);
  }
  return [...seen.values()].sort((a, b) => a - b);
}

function forecastFor(input: WindowInput, cycle: boolean, now: number, durationMs: number): Forecast {
  if (!cycle) return input.kind === 'fiveHour' && durationMs > FIVE_HOUR_PROJECTION_MAX_MS ? { status: 'unavailable' } : input.forecast;
  if (input.kind === 'fiveHour') return { status: 'unavailable' };
  return dailyAverageForecast(input.points, now, input.resetsAt) ?? input.forecast;
}

export function buildChartModel(
  inputs: readonly WindowInput[],
  range: UsageRange,
  now: number,
): UsageChartModel {
  const weeklyResetsAt = inputs.find((input) => input.kind === 'sevenDay')?.resetsAt ?? null;
  const cycle = range.cycle === true && isCycleAvailable(weeklyResetsAt, now);
  const effective = range.cycle === true && !cycle ? usageRange(DEFAULT_USAGE_RANGE) : range;
  const xMax = cycle ? (weeklyResetsAt as number) : now + effective.durationMs * FUTURE_SHARE;
  const xMin = cycle ? xMax - CYCLE_MS : now - effective.durationMs;
  const fiveHour = inputs.find((input) => input.kind === 'fiveHour');
  const ahead = fiveHour?.resetsAt != null && fiveHour.resetsAt > now && fiveHour.resetsAt <= xMax ? [fiveHour.resetsAt] : [];
  const windows = inputs.map((input): WindowSeries => {
    const forecast = forecastFor(input, cycle, now, effective.durationMs);
    return {
      kind: input.kind,
      label: input.label,
      points: withGaps(
        (cycle
          ? input.points.filter((point) => point.at >= xMin && point.at <= now)
          : pointsInRange(input.points, effective, now)
        ).map((point): ChartPoint => [point.at, point.utilization]),
        now,
      ),
      trend: trendPoints(forecast, xMax, cycle ? MAX_AXIS_MAX : BASE_AXIS_MAX),
      projectAt: cycle && input.kind === 'sevenDay' ? projector(forecast) : null,
      resetsAt: input.resetsAt,
    };
  });
  return {
    now,
    xMin,
    xMax,
    rangeMs: cycle ? CYCLE_MS : effective.durationMs,
    cycle,
    yMax: !cycle ? BASE_AXIS_MAX : axisMaxFor(windows.flatMap((window) => window.trend?.map((point) => point[1]) ?? [])),
    fiveHourResets: cycle ? [...new Set([...pastFiveHourResets(fiveHour?.points ?? [], xMin, now), ...ahead])] : [],
    windows,
  };
}
