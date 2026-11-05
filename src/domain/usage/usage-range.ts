import { DAY_MS, HOUR_MS } from '../time';
import type { UsagePoint } from './usage-history';

export interface UsageRange {
  id: string;
  label: string;
  durationMs: number;
}

export const USAGE_RANGES: readonly UsageRange[] = [
  { id: '1h', label: '1h', durationMs: HOUR_MS },
  { id: '12h', label: '12h', durationMs: 12 * HOUR_MS },
  { id: '1d', label: '1d', durationMs: DAY_MS },
  { id: '7d', label: '7d', durationMs: 7 * DAY_MS },
  { id: '30d', label: '30d', durationMs: 30 * DAY_MS },
];

export const DEFAULT_USAGE_RANGE = '12h';

export function usageRange(id: string): UsageRange {
  return USAGE_RANGES.find((range) => range.id === id) ?? USAGE_RANGES[0]!;
}

export function pointsInRange(points: readonly UsagePoint[], range: UsageRange, now: number): UsagePoint[] {
  const from = now - range.durationMs;
  return points.filter((point) => point.at >= from && point.at <= now);
}
