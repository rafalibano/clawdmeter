import { asNumber, asText, asTimestamp, isRecord } from './payload';

export interface ModelLimit {
  name: string;
  utilization: number;
  resetsAt: number | null;
}

const FIXED_MODEL_WINDOWS = [
  { field: 'seven_day_opus', name: 'Opus' },
  { field: 'seven_day_sonnet', name: 'Sonnet' },
] as const;

function readLimitRow(raw: unknown): ModelLimit | null {
  if (!isRecord(raw) || raw['group'] === 'session') return null;
  const scope = raw['scope'];
  const model = isRecord(scope) ? scope['model'] : null;
  const name = isRecord(model) ? asText(model['display_name']) : null;
  const percent = asNumber(raw['percent']);
  if (name === null || percent === null) return null;
  return { name, utilization: Math.max(0, percent), resetsAt: asTimestamp(raw['resets_at']) };
}

function readFixedWindow(raw: unknown, name: string): ModelLimit | null {
  if (!isRecord(raw)) return null;
  const utilization = asNumber(raw['utilization']);
  if (utilization === null) return null;
  return { name, utilization: Math.max(0, utilization), resetsAt: asTimestamp(raw['resets_at']) };
}

function addLimit(limits: ModelLimit[], limit: ModelLimit): void {
  const key = limit.name.toLowerCase();
  const index = limits.findIndex((known) => known.name.toLowerCase() === key);
  if (index === -1) limits.push(limit);
  else if (limit.utilization > limits[index]!.utilization) limits[index] = limit;
}

export function parseModelLimits(record: Record<string, unknown>): ModelLimit[] {
  const limits: ModelLimit[] = [];
  const rows = Array.isArray(record['limits']) ? record['limits'] : [];
  for (const row of rows) {
    const limit = readLimitRow(row);
    if (limit !== null) addLimit(limits, limit);
  }
  for (const { field, name } of FIXED_MODEL_WINDOWS) {
    const covered = limits.some((limit) => limit.name.toLowerCase().includes(name.toLowerCase()));
    const fixed = covered ? null : readFixedWindow(record[field], name);
    if (fixed !== null) addLimit(limits, fixed);
  }
  return limits;
}
