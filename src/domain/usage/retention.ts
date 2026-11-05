import { DAY_MS, MINUTE_MS } from '../time';
import type { UsageHistory, UsagePoint } from './usage-history';

export const RAW_RETENTION_MS = 7 * DAY_MS;
export const TOTAL_RETENTION_MS = 30 * DAY_MS;
export const AGGREGATE_BUCKET_MS = 15 * MINUTE_MS;

export function retainPoints(points: readonly UsagePoint[], now: number): UsagePoint[] {
  const rawFrom = now - RAW_RETENTION_MS;
  const keepFrom = now - TOTAL_RETENTION_MS;
  const buckets = new Map<number, UsagePoint>();
  const recent: UsagePoint[] = [];
  for (const point of points) {
    if (point.at < keepFrom) continue;
    if (point.at >= rawFrom) {
      recent.push(point);
      continue;
    }
    const start = Math.floor(point.at / AGGREGATE_BUCKET_MS) * AGGREGATE_BUCKET_MS;
    const current = buckets.get(start);
    if (current === undefined || point.utilization >= current.utilization) {
      buckets.set(start, {
        at: start,
        utilization: point.utilization,
        resetsAt: point.resetsAt,
        ...(point.imported ? { imported: true as const } : {}),
      });
    }
  }
  const aggregated = [...buckets.values()].sort((a, b) => a.at - b.at);
  return [...aggregated, ...recent];
}

export function retainHistory(history: UsageHistory, now: number): UsageHistory {
  return { fiveHour: retainPoints(history.fiveHour, now), sevenDay: retainPoints(history.sevenDay, now) };
}
