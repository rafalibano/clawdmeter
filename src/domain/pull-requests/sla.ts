const DAY = 24 * 60 * 60_000;

export const SLA_ATTENTION_DAYS = 3;
export const SLA_OVERDUE_DAYS = 7;

export type SlaLevel = 'fresh' | 'attention' | 'overdue';

export function slaLevel(since: number, now: number): SlaLevel {
  const elapsed = now - since;
  if (elapsed >= SLA_OVERDUE_DAYS * DAY) return 'overdue';
  if (elapsed >= SLA_ATTENTION_DAYS * DAY) return 'attention';
  return 'fresh';
}
