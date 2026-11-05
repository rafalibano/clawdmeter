export const REFRESH_COOLDOWN_MS = 30_000;

export interface RefreshInput {
  now: number;
  loading: boolean;
  cooldownUntil: number;
  backoffUntil: number | null;
}

export type RefreshTooltip =
  | { key: 'refresh.tooltip' }
  | { key: 'refresh.loading' }
  | { key: 'refresh.cooldown'; remainingMs: number }
  | { key: 'refresh.rateLimited'; remainingMs: number };

export interface RefreshState {
  disabled: boolean;
  spinning: boolean;
  tooltip: RefreshTooltip;
}

export function refreshState(input: RefreshInput): RefreshState {
  const { now, loading, cooldownUntil, backoffUntil } = input;
  if (loading) return { disabled: true, spinning: true, tooltip: { key: 'refresh.loading' } };
  if (backoffUntil !== null && backoffUntil > now) {
    return { disabled: true, spinning: false, tooltip: { key: 'refresh.rateLimited', remainingMs: backoffUntil - now } };
  }
  if (cooldownUntil > now) {
    return { disabled: true, spinning: false, tooltip: { key: 'refresh.cooldown', remainingMs: cooldownUntil - now } };
  }
  return { disabled: false, spinning: false, tooltip: { key: 'refresh.tooltip' } };
}
