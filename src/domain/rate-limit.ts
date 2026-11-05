import { MINUTE_MS } from './time';

export const RATE_LIMIT_BACKOFF_MS: readonly number[] = [5 * MINUTE_MS, 10 * MINUTE_MS, 20 * MINUTE_MS, 30 * MINUTE_MS];

export class RateLimitedError extends Error {
  constructor(readonly retryAfterMs: number | null = null) {
    super('rate_limited');
    this.name = 'RateLimitedError';
  }
}

export function rateLimitDelay(consecutiveFailures: number, retryAfterMs: number | null): number {
  const step = Math.min(Math.max(consecutiveFailures, 1), RATE_LIMIT_BACKOFF_MS.length) - 1;
  return Math.max(retryAfterMs ?? 0, RATE_LIMIT_BACKOFF_MS[step]!);
}

const HTTP_BACKOFF_STATUS = /\b(429|5\d\d)\b/;

export function isBackoffMessage(message: string): boolean {
  return HTTP_BACKOFF_STATUS.test(message);
}
