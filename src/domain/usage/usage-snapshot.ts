export interface UsageWindowReading {
  utilization: number;
  resetsAt: number | null;
}

export interface UsageSnapshot {
  fiveHour: UsageWindowReading | null;
  sevenDay: UsageWindowReading | null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asTimestamp(value: unknown): number | null {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const numeric = asNumber(value);
  if (numeric === null) return null;
  return numeric < 1e11 ? numeric * 1_000 : numeric;
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
  };
  if (snapshot.fiveHour === null && snapshot.sevenDay === null) {
    throw new Error('Usage response has neither five_hour nor seven_day.');
  }
  return snapshot;
}
