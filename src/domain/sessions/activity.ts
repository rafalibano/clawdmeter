import type { SessionAttentionConfig } from './attention';
import { statusSince, type ClaudeSession } from './claude-session';

export type SessionActivity = 'active' | 'inactive';

export function sessionActivity(
  session: ClaudeSession,
  now: number,
  config: Pick<SessionAttentionConfig, 'waitingInputAfterMs'>,
): SessionActivity {
  if (session.status === 'busy') return 'active';
  if (session.status !== 'idle') return 'inactive';
  const since = statusSince(session);
  return since !== null && now - since < config.waitingInputAfterMs ? 'active' : 'inactive';
}
