import { DAY_MS, HOUR_MS } from '../time';

export type UsageWindowKind = 'fiveHour' | 'sevenDay';

export interface UsageWindowDefinition {
  kind: UsageWindowKind;
  label: string;
  durationMs: number;
  regressionWindowMs: number;
}

export const USAGE_WINDOWS: readonly UsageWindowDefinition[] = [
  { kind: 'fiveHour', label: '5h', durationMs: 5 * HOUR_MS, regressionWindowMs: HOUR_MS },
  { kind: 'sevenDay', label: '7d', durationMs: 7 * DAY_MS, regressionWindowMs: DAY_MS },
];

export function usageWindow(kind: UsageWindowKind): UsageWindowDefinition {
  const definition = USAGE_WINDOWS.find((window) => window.kind === kind);
  if (!definition) throw new Error(`Janela de usage desconhecida: ${kind}`);
  return definition;
}
