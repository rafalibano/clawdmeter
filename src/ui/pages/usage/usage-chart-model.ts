import {
  DEFAULT_USAGE_RANGE,
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

export const FUTURE_SHARE = 0.15;
export const CYCLE_MS = 7 * DAY_MS;
export const BASE_AXIS_MAX = 100;
export const MAX_AXIS_MAX = 300;
export const AXIS_STEP = 25;

export type ChartPoint = [at: number, value: number];
export type SeriesPoint = [at: number, value: number | null];

export const ESTIMATED_GAP_MS = 2 * HOUR_MS;
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
  estimated: SeriesPoint[];
  estimatedSpans: Array<[from: number, to: number]>;
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

const RESET_DROP_TOLERANCE = 1;

export interface FilledSeries {
  measured: SeriesPoint[];
  estimated: SeriesPoint[];
  spans: Array<[from: number, to: number]>;
}

function resetBetween(previous: UsagePoint, next: UsagePoint): boolean {
  if (next.utilization < previous.utilization - RESET_DROP_TOLERANCE) return true;
  return previous.resetsAt !== null && previous.resetsAt > previous.at && previous.resetsAt <= next.at;
}

function resetInstant(previous: UsagePoint, next: UsagePoint): number {
  const known = previous.resetsAt;
  if (known !== null && known > previous.at && known <= next.at) return known;
  return Math.round((previous.at + next.at) / 2);
}

function pushEdge(target: SeriesPoint[], edge: readonly ChartPoint[]): void {
  const last = target[target.length - 1];
  const first = edge[0]!;
  if (last !== undefined && (last[0] !== first[0] || last[1] !== first[1])) target.push([last[0] + 1, null]);
  for (const point of edge) {
    const tail = target[target.length - 1];
    if (tail === undefined || tail[0] !== point[0] || tail[1] !== point[1]) target.push(point);
  }
}

export function fillGaps(points: readonly UsagePoint[]): FilledSeries {
  const measured: SeriesPoint[] = [];
  const estimated: SeriesPoint[] = [];
  const spans: Array<[number, number]> = [];
  const first = points[0];
  if (first === undefined) return { measured, estimated, spans };
  measured.push([first.at, first.utilization]);
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const next = points[index]!;
    const edge: ChartPoint[] = [[previous.at, previous.utilization]];
    if (resetBetween(previous, next)) {
      const at = resetInstant(previous, next);
      edge.push([at, previous.utilization], [at, 0]);
    }
    edge.push([next.at, next.utilization]);
    if (next.at - previous.at > ESTIMATED_GAP_MS) {
      pushEdge(estimated, edge);
      spans.push([previous.at, next.at]);
      if (index === points.length - 1) pushEdge(measured, [edge[edge.length - 1]!]);
    } else {
      pushEdge(measured, edge);
    }
  }
  return { measured, estimated, spans };
}

export function estimatedValueAt(estimated: readonly SeriesPoint[], at: number): number | null {
  for (let index = 1; index < estimated.length; index++) {
    const from = estimated[index - 1]!;
    const to = estimated[index]!;
    if (from[1] === null || to[1] === null || to[0] <= from[0] || at < from[0] || at > to[0]) continue;
    return from[1] + ((to[1] - from[1]) * (at - from[0])) / (to[0] - from[0]);
  }
  return null;
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
    const filled = fillGaps(visible);
    return {
      kind: input.kind,
      label: input.label,
      points: filled.measured,
      estimated: filled.estimated,
      estimatedSpans: filled.spans,
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
