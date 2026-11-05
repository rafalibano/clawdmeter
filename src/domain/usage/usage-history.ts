import type { UsageSnapshot } from './usage-snapshot';
import type { UsageWindowKind } from './usage-window';

export interface UsagePoint {
  at: number;
  utilization: number;
  resetsAt: number | null;
  imported?: true;
}

export type UsageHistory = Record<UsageWindowKind, UsagePoint[]>;

export const HISTORY_SCHEMA_VERSION = 1;

export function createEmptyHistory(): UsageHistory {
  return { fiveHour: [], sevenDay: [] };
}

function appendPoint(points: readonly UsagePoint[], point: UsagePoint): UsagePoint[] {
  const last = points[points.length - 1];
  if (last === undefined || point.at > last.at) return [...points, point];
  return [...points.filter((existing) => existing.at !== point.at), point].sort((a, b) => a.at - b.at);
}

export function recordSnapshot(history: UsageHistory, snapshot: UsageSnapshot, at: number): UsageHistory {
  const next = { ...history };
  for (const kind of ['fiveHour', 'sevenDay'] as const) {
    const reading = snapshot[kind];
    if (reading !== null) {
      next[kind] = appendPoint(history[kind], { at, utilization: reading.utilization, resetsAt: reading.resetsAt });
    }
  }
  return next;
}

type StoredPoint = [number, number, number | null] | [number, number, number | null, 1];

function parsePoints(raw: unknown): UsagePoint[] {
  if (!Array.isArray(raw)) return [];
  const points: UsagePoint[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) continue;
    const [at, utilization, resetsAt, imported] = entry as unknown[];
    if (typeof at !== 'number' || typeof utilization !== 'number') continue;
    if (!Number.isFinite(at) || !Number.isFinite(utilization)) continue;
    const point: UsagePoint = {
      at,
      utilization,
      resetsAt: typeof resetsAt === 'number' && Number.isFinite(resetsAt) ? resetsAt : null,
    };
    if (imported === 1) point.imported = true;
    points.push(point);
  }
  return points.sort((a, b) => a.at - b.at);
}

export function parseHistory(raw: unknown): UsageHistory {
  if (typeof raw !== 'object' || raw === null) return createEmptyHistory();
  const record = raw as Record<string, unknown>;
  return { fiveHour: parsePoints(record['fiveHour']), sevenDay: parsePoints(record['sevenDay']) };
}

export function serializeHistory(history: UsageHistory): unknown {
  const encode = (points: readonly UsagePoint[]): StoredPoint[] =>
    points.map((point) =>
      point.imported ? [point.at, point.utilization, point.resetsAt, 1] : [point.at, point.utilization, point.resetsAt],
    );
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    fiveHour: encode(history.fiveHour),
    sevenDay: encode(history.sevenDay),
  };
}
