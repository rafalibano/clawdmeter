import { HOUR_MS, MINUTE_MS } from '../time';
import type { UsagePoint } from './usage-history';
import { RESET_JITTER_MS } from './usage-window';

export const LEVEL_GAP_MS = 15 * MINUTE_MS;
export const SMOOTH_HOLD_GAP_MS = 3 * HOUR_MS;

export type LevelPoint = [at: number, value: number];

export function levelAt(point: UsagePoint, at: number): number {
  return point.resetsAt !== null && point.resetsAt <= at + RESET_JITTER_MS ? 0 : point.utilization;
}

function lastBefore(points: readonly UsagePoint[], at: number): UsagePoint | undefined {
  let found: UsagePoint | undefined;
  for (const point of points) {
    if (point.at >= at) break;
    found = point;
  }
  return found;
}

function hold(anchor: UsagePoint, until: number, beforeNext: boolean): LevelPoint[] {
  const steps: LevelPoint[] = [];
  let level = anchor.utilization;
  if (anchor.resetsAt !== null && anchor.resetsAt > anchor.at - RESET_JITTER_MS && anchor.resetsAt < until) {
    const dropAt = Math.max(anchor.resetsAt, anchor.at);
    steps.push([dropAt, level], [dropAt, 0]);
    level = 0;
  }
  steps.push([beforeNext ? until - 1 : until, level]);
  return steps;
}

type Emit = (anchor: UsagePoint, until: number, hasNext: boolean, carried: boolean) => LevelPoint[];

function walk(points: readonly UsagePoint[], from: number, to: number, emit: Emit): LevelPoint[] {
  const before = lastBefore(points, from);
  const steps: LevelPoint[] = [];
  let carried: UsagePoint | undefined;
  if (before !== undefined) {
    const resetsAt = before.resetsAt !== null && before.resetsAt > from + RESET_JITTER_MS ? before.resetsAt : null;
    carried = { at: from, utilization: levelAt(before, from), resetsAt };
    steps.push([from, carried.utilization]);
  }
  let anchor = carried;
  const inside = points.filter((point) => point.at >= from && point.at <= to);
  for (const next of [...inside, null]) {
    const until = next?.at ?? to;
    if (anchor !== undefined && until > anchor.at) steps.push(...emit(anchor, until, next !== null, anchor === carried));
    if (next !== null) anchor = next;
  }
  return steps;
}

export function levelSteps(points: readonly UsagePoint[], from: number, to: number, minGapMs: number = LEVEL_GAP_MS): LevelPoint[] {
  const gapMs = Math.max(LEVEL_GAP_MS, minGapMs);
  return walk(points, from, to, (anchor, until, hasNext, carried) =>
    carried || until - anchor.at > gapMs ? hold(anchor, until, hasNext) : [],
  );
}

function resetDrop(anchor: UsagePoint, until: number): LevelPoint[] {
  if (anchor.resetsAt === null || anchor.resetsAt <= anchor.at - RESET_JITTER_MS || anchor.resetsAt >= until) return [];
  const dropAt = Math.max(anchor.resetsAt, anchor.at);
  return [
    [dropAt, anchor.utilization],
    [dropAt, 0],
  ];
}

export function smoothLevelSteps(points: readonly UsagePoint[], from: number, to: number, minGapMs: number = LEVEL_GAP_MS): LevelPoint[] {
  const tailGapMs = Math.max(LEVEL_GAP_MS, minGapMs);
  const holdGapMs = Math.max(SMOOTH_HOLD_GAP_MS, tailGapMs);
  return walk(points, from, to, (anchor, until, hasNext, carried) =>
    carried || until - anchor.at > (hasNext ? holdGapMs : tailGapMs) ? hold(anchor, until, hasNext) : resetDrop(anchor, until),
  );
}
