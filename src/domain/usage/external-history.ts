import { MINUTE_MS } from '../time';
import { TOTAL_RETENTION_MS } from './retention';
import type { UsageHistory, UsagePoint } from './usage-history';
import type { UsageWindowKind } from './usage-window';

export interface ExternalUsagePoint {
  at: number;
  fiveHour: number | null;
  sevenDay: number | null;
}

export const EXTERNAL_DEDUPE_TOLERANCE_MS = MINUTE_MS;
const MAX_FRACTION = 2;
const FUTURE_SKEW_MS = 5 * MINUTE_MS;

function asTimestamp(value: unknown): number | null {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e11 ? value * 1_000 : value;
}

function fractionToPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_FRACTION) return null;
  return Math.round(value * 10_000) / 100;
}

export function parseClaudeUsageBarHistory(raw: unknown): ExternalUsagePoint[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const entries = (raw as Record<string, unknown>)['dataPoints'];
  if (!Array.isArray(entries)) return [];
  const points: ExternalUsagePoint[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const at = asTimestamp(record['timestamp']);
    const fiveHour = fractionToPercent(record['pct5h']);
    const sevenDay = fractionToPercent(record['pct7d']);
    if (at === null || (fiveHour === null && sevenDay === null)) continue;
    points.push({ at, fiveHour, sevenDay });
  }
  return points.sort((a, b) => a.at - b.at);
}

function nearAny(existing: readonly UsagePoint[], cursor: { index: number }, at: number): boolean {
  while (cursor.index < existing.length && existing[cursor.index]!.at < at - EXTERNAL_DEDUPE_TOLERANCE_MS) cursor.index++;
  const candidate = existing[cursor.index];
  return candidate !== undefined && candidate.at <= at + EXTERNAL_DEDUPE_TOLERANCE_MS;
}

function importKind(
  existing: readonly UsagePoint[],
  external: readonly ExternalUsagePoint[],
  kind: UsageWindowKind,
  now: number,
): UsagePoint[] {
  const cursor = { index: 0 };
  const accepted: UsagePoint[] = [];
  let lastAt = Number.NEGATIVE_INFINITY;
  for (const point of external) {
    const utilization = point[kind];
    if (utilization === null) continue;
    if (point.at < now - TOTAL_RETENTION_MS || point.at > now + FUTURE_SKEW_MS) continue;
    if (point.at - lastAt <= EXTERNAL_DEDUPE_TOLERANCE_MS || nearAny(existing, cursor, point.at)) continue;
    accepted.push({ at: point.at, utilization, resetsAt: null, imported: true });
    lastAt = point.at;
  }
  if (accepted.length === 0) return existing as UsagePoint[];
  return [...existing, ...accepted].sort((a, b) => a.at - b.at);
}

export function mergeExternalPoints(history: UsageHistory, external: readonly ExternalUsagePoint[], now: number): UsageHistory {
  const sorted = [...external].sort((a, b) => a.at - b.at);
  return {
    fiveHour: importKind(history.fiveHour, sorted, 'fiveHour', now),
    sevenDay: importKind(history.sevenDay, sorted, 'sevenDay', now),
  };
}
