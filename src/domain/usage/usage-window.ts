import { DAY_MS, HOUR_MS, MINUTE_MS } from '../time';

export const RESET_JITTER_MS = MINUTE_MS;

export type UsageWindowKind = 'fiveHour' | 'sevenDay';

export interface UsageWindowDefinition {
  kind: UsageWindowKind;
  label: string;
  durationMs: number;
}

export const USAGE_WINDOWS: readonly UsageWindowDefinition[] = [
  { kind: 'fiveHour', label: '5h', durationMs: 5 * HOUR_MS },
  { kind: 'sevenDay', label: '7d', durationMs: 7 * DAY_MS },
];

export function usageWindow(kind: UsageWindowKind): UsageWindowDefinition {
  const definition = USAGE_WINDOWS.find((window) => window.kind === kind);
  if (!definition) throw new Error(`Unknown usage window: ${kind}`);
  return definition;
}
