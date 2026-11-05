import type { UsageWindowKind } from '../../../domain/usage';

export type UsageTone = 'base' | 'attention' | 'danger';

export const WEEKLY_ATTENTION_AT = 70;
export const WEEKLY_DANGER_AT = 90;

export function usageTone(kind: UsageWindowKind, value: number): UsageTone {
  if (kind === 'fiveHour') return 'base';
  if (value >= WEEKLY_DANGER_AT) return 'danger';
  return value >= WEEKLY_ATTENTION_AT ? 'attention' : 'base';
}
