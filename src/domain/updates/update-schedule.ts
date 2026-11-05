import { HOUR_MS, MINUTE_MS } from '../time';

export const UPDATE_CHECK_INTERVAL_MS = 6 * HOUR_MS;
export const UPDATE_CHECK_TICK_MS = 15 * MINUTE_MS;
export const UPDATE_RATE_LIMIT_FALLBACK_MS = HOUR_MS;

export interface UpdateSchedule {
  lastAttemptAt: number | null;
  blockedUntil: number | null;
}

export function isRateLimited(schedule: UpdateSchedule, now: number): boolean {
  return schedule.blockedUntil !== null && now < schedule.blockedUntil;
}

export function isCheckDue(schedule: UpdateSchedule, now: number): boolean {
  if (isRateLimited(schedule, now)) return false;
  return schedule.lastAttemptAt === null || now - schedule.lastAttemptAt >= UPDATE_CHECK_INTERVAL_MS;
}

export function rateLimitedUntil(now: number, retryAfterMs: number | null): number {
  return now + Math.max(retryAfterMs ?? UPDATE_RATE_LIMIT_FALLBACK_MS, MINUTE_MS);
}
