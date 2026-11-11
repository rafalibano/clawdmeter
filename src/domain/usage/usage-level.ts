import { MINUTE_MS } from '../time';
import type { UsagePoint } from './usage-history';

export const LEVEL_GAP_MS = 15 * MINUTE_MS;

export type LevelPoint = [at: number, value: number];

export function levelAt(point: UsagePoint, at: number): number {
  return point.resetsAt !== null && point.resetsAt <= at ? 0 : point.utilization;
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
  if (anchor.resetsAt !== null && anchor.resetsAt > anchor.at && anchor.resetsAt < until) {
    steps.push([anchor.resetsAt, level], [anchor.resetsAt, 0]);
    level = 0;
  }
  steps.push([beforeNext ? until - 1 : until, level]);
  return steps;
}

export function levelSteps(points: readonly UsagePoint[], from: number, to: number, minGapMs: number = LEVEL_GAP_MS): LevelPoint[] {
  const gapMs = Math.max(LEVEL_GAP_MS, minGapMs);
  const before = lastBefore(points, from);
  const steps: LevelPoint[] = [];
  let carried: UsagePoint | undefined;
  if (before !== undefined) {
    const resetsAt = before.resetsAt !== null && before.resetsAt > from ? before.resetsAt : null;
    carried = { at: from, utilization: levelAt(before, from), resetsAt };
    steps.push([from, carried.utilization]);
  }
  let anchor = carried;
  const inside = points.filter((point) => point.at >= from && point.at <= to);
  for (const next of [...inside, null]) {
    const until = next?.at ?? to;
    if (anchor !== undefined && until > anchor.at && (anchor === carried || until - anchor.at > gapMs)) {
      steps.push(...hold(anchor, until, next !== null));
    }
    if (next !== null) anchor = next;
  }
  return steps;
}
