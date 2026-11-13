import { parseExtraUsage, type ExtraUsage } from './extra-usage';
import { parseModelLimits, type ModelLimit } from './model-limits';
import { asNumber, asTimestamp } from './payload';

export interface UsageWindowReading {
  utilization: number;
  resetsAt: number | null;
}

export interface UsageSnapshot {
  fiveHour: UsageWindowReading | null;
  sevenDay: UsageWindowReading | null;
  modelLimits?: readonly ModelLimit[];
  extraUsage?: ExtraUsage | null;
}

function parseWindow(raw: unknown): UsageWindowReading | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const utilization = asNumber(record['utilization']);
  if (utilization === null) return null;
  return { utilization: Math.max(0, utilization), resetsAt: asTimestamp(record['resets_at']) };
}

export function parseUsageResponse(raw: unknown): UsageSnapshot {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const snapshot: UsageSnapshot = {
    fiveHour: parseWindow(record['five_hour']),
    sevenDay: parseWindow(record['seven_day']),
    modelLimits: parseModelLimits(record),
    extraUsage: parseExtraUsage(record),
  };
  if (snapshot.fiveHour === null && snapshot.sevenDay === null) {
    throw new Error('Usage response has neither five_hour nor seven_day.');
  }
  return snapshot;
}
