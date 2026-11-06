import type { UsageWindowReading } from './usage-snapshot';
import type { UsageWindowKind } from './usage-window';

export type Quartile = 25 | 50 | 75 | 100;

export const QUARTILES: readonly Quartile[] = [25, 50, 75, 100];

export type UsageAlertSettings = Record<UsageWindowKind, Quartile[]>;

export interface WindowAlertState {
  reached: number;
  resetsAt: number | null;
}

export interface WindowAlertOutcome {
  alert: Quartile | null;
  state: WindowAlertState;
}

const RESET_JITTER_MS = 60_000;

export const DROP_MARGIN = 5;

export function normalizeQuartiles(value: unknown): Quartile[] {
  if (!Array.isArray(value)) return [];
  return QUARTILES.filter((quartile) => value.includes(quartile));
}

export function defaultUsageAlerts(): UsageAlertSettings {
  return { fiveHour: [50], sevenDay: [50] };
}

function highestCrossed(utilization: number): number {
  return QUARTILES.filter((quartile) => utilization >= quartile).at(-1) ?? 0;
}

function resetsAtChanged(state: WindowAlertState, reading: UsageWindowReading): boolean {
  if (state.resetsAt === null || reading.resetsAt === null) return false;
  return Math.abs(reading.resetsAt - state.resetsAt) > RESET_JITTER_MS;
}

export function evaluateUsageAlert(
  previous: WindowAlertState | null,
  reading: UsageWindowReading,
  selected: readonly Quartile[],
): WindowAlertOutcome {
  const current = highestCrossed(reading.utilization);
  if (previous === null) return { alert: null, state: { reached: current, resetsAt: reading.resetsAt } };
  const resetsAt = reading.resetsAt ?? previous.resetsAt;
  const newCycle = resetsAtChanged(previous, reading);
  if (!newCycle && reading.utilization < previous.reached - DROP_MARGIN) {
    return { alert: null, state: { reached: current, resetsAt } };
  }
  const base = newCycle ? 0 : previous.reached;
  const alert = QUARTILES.filter((quartile) => quartile > base && quartile <= current && selected.includes(quartile)).at(-1) ?? null;
  return { alert, state: { reached: Math.max(base, current), resetsAt } };
}
