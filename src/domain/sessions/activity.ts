import type { ClaudeSession } from './claude-session';

export type SessionActivity = 'active' | 'inactive';

export function sessionActivity(session: Pick<ClaudeSession, 'status'>): SessionActivity {
  return session.status === 'busy' ? 'active' : 'inactive';
}
