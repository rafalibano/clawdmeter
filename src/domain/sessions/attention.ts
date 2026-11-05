import { MINUTE_MS } from '../time';
import { statusSince, type ClaudeSession } from './claude-session';

export type SessionAttention = 'waiting-input' | 'running-long';

export interface SessionAttentionConfig {
  waitingInputAfterMs: number;
  runningLongAfterMs: number;
}

export const DEFAULT_ATTENTION_CONFIG: SessionAttentionConfig = {
  waitingInputAfterMs: 5 * MINUTE_MS,
  runningLongAfterMs: 30 * MINUTE_MS,
};

export function sessionAttention(
  session: ClaudeSession,
  now: number,
  config: SessionAttentionConfig,
): SessionAttention | null {
  const since = statusSince(session);
  if (since === null) return null;
  const elapsed = Math.max(0, now - since);
  if (session.status === 'idle' && elapsed >= config.waitingInputAfterMs) return 'waiting-input';
  if (session.status === 'busy' && elapsed >= config.runningLongAfterMs) return 'running-long';
  return null;
}

export function sortSessions(
  sessions: readonly ClaudeSession[],
  now: number,
  config: SessionAttentionConfig,
): ClaudeSession[] {
  const flagged = (session: ClaudeSession) => (sessionAttention(session, now, config) === null ? 1 : 0);
  return [...sessions].sort(
    (a, b) => flagged(a) - flagged(b) || (statusSince(b) ?? 0) - (statusSince(a) ?? 0) || a.pid - b.pid,
  );
}
