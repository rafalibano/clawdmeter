import { DAY_MS, HOUR_MS } from '../time';
import type { UsagePoint } from './usage-history';

export interface UsageRange {
  id: string;
  label: string;
  durationMs: number;
  cycle?: boolean;
}

export const USAGE_RANGES: readonly UsageRange[] = [
  { id: '1h', label: '1h', durationMs: HOUR_MS },
  { id: '6h', label: '6h', durationMs: 6 * HOUR_MS },
  { id: '1d', label: '1d', durationMs: DAY_MS },
  { id: '7d', label: '7d', durationMs: 7 * DAY_MS },
  { id: '30d', label: '30d', durationMs: 30 * DAY_MS },
  { id: 'cycle', label: 'Reset', durationMs: 7 * DAY_MS, cycle: true },
];

export const DEFAULT_USAGE_RANGE = '6h';

export function usageRange(id: string): UsageRange {
  return USAGE_RANGES.find((range) => range.id === id) ?? USAGE_RANGES[0]!;
}

export const CYCLE_RANGE_ID = 'cycle';

export function isCycleAvailable(weeklyResetsAt: number | null, now: number): weeklyResetsAt is number {
  return weeklyResetsAt !== null && weeklyResetsAt > now;
}

export function pointsInRange(points: readonly UsagePoint[], range: UsageRange, now: number): UsagePoint[] {
  const from = now - range.durationMs;
  return points.filter((point) => point.at >= from && point.at <= now);
}
