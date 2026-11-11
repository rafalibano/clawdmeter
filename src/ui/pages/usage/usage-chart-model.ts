import {
  DEFAULT_USAGE_RANGE,
  isCycleAvailable,
  levelSteps,
  pointsInRange,
  trendValueAt,
  usageRange,
  type Forecast,
  type UsagePoint,
  type UsageRange,
  type UsageWindowKind,
} from '../../../domain/usage';
import { DAY_MS, MINUTE_MS } from '../../../domain/time';

export const FUTURE_SHARE = 0.15;
export const CYCLE_MS = 7 * DAY_MS;
export const BASE_AXIS_MAX = 100;
export const MAX_AXIS_MAX = 300;
export const BASE_AXIS_STEP = 25;
export const EXPANDED_AXIS_STEP = 50;

export type ChartPoint = [at: number, value: number];

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
  points: ChartPoint[];
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
  return Math.min(MAX_AXIS_MAX, (Math.floor(peak / EXPANDED_AXIS_STEP) + 1) * EXPANDED_AXIS_STEP);
}

export function projector(forecast: Forecast): ((at: number) => number) | null {
  if (forecast.status !== 'ready') return null;
  const { trend } = forecast;
  return (at) => trendValueAt(trend, at);
}

export const CHART_BUCKETS = 120;

export function downsample(points: readonly UsagePoint[], from: number, to: number, buckets: number = CHART_BUCKETS): ChartPoint[] {
  const width = (to - from) / buckets;
  if (!(width > 0)) return points.map((point) => [point.at, point.utilization]);
  const sums = new Map<number, { at: number; value: number; count: number }>();
  for (const point of points) {
    const index = Math.min(buckets - 1, Math.max(0, Math.floor((point.at - from) / width)));
    const sum = sums.get(index) ?? { at: 0, value: 0, count: 0 };
    sum.at += point.at;
    sum.value += point.utilization;
    sum.count += 1;
    sums.set(index, sum);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, sum]) => [sum.at / sum.count, sum.value / sum.count]);
}

function withLevels(points: readonly ChartPoint[], levels: readonly ChartPoint[]): ChartPoint[] {
  return [...points, ...levels].sort((a, b) => a[0] - b[0]);
}

export function curveValueAt(points: readonly ChartPoint[], at: number): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || at < first[0]) return null;
  if (at >= last[0]) return last[1];
  const index = points.findIndex((point, position) => point[0] <= at && at <= (points[position + 1]?.[0] ?? Number.NEGATIVE_INFINITY));
  const p1 = points[index]!;
  const p2 = points[index + 1]!;
  const p0 = points[index - 1] ?? p1;
  const p3 = points[index + 2] ?? p2;
  const t = p2[0] === p1[0] ? 0 : (at - p1[0]) / (p2[0] - p1[0]);
  const [y0, y1, y2, y3] = [p0[1], p1[1], p2[1], p3[1]];
  const value = 0.5 * (2 * y1 + (y2 - y0) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t * t + (3 * y1 - y0 - 3 * y2 + y3) * t * t * t);
  return Math.min(Math.max(value, Math.min(y1, y2)), Math.max(y1, y2));
}

function pastFiveHourResets(points: readonly UsagePoint[], xMin: number, xMax: number): number[] {
  const seen = new Map<number, number>();
  for (const point of points) {
    if (point.resetsAt === null || point.resetsAt < xMin || point.resetsAt > xMax) continue;
    seen.set(Math.round(point.resetsAt / (5 * MINUTE_MS)), point.resetsAt);
  }
  return [...seen.values()].sort((a, b) => a - b);
}

function forecastFor(input: WindowInput, cycle: boolean, durationMs: number): Forecast {
  if (!cycle) return input.kind === 'fiveHour' && durationMs > FIVE_HOUR_PROJECTION_MAX_MS ? { status: 'unavailable' } : input.forecast;
  return input.kind === 'fiveHour' ? { status: 'unavailable' } : input.forecast;
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
    const forecast = forecastFor(input, cycle, effective.durationMs);
    const visible = cycle
      ? input.points.filter((point) => point.at >= xMin && point.at <= now)
      : pointsInRange(input.points, effective, now);
    return {
      kind: input.kind,
      label: input.label,
      points: withLevels(downsample(visible, xMin, now), levelSteps(input.points, xMin, now, (2 * (now - xMin)) / CHART_BUCKETS)),
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
