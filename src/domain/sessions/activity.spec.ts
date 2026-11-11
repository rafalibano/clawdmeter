import { describe, expect, it } from 'vitest';
import { MINUTE_MS } from '../time';
import { sessionActivity } from './activity';
import { DEFAULT_ATTENTION_CONFIG } from './attention';
import type { ClaudeSession } from './claude-session';

const NOW = 1_800_000_000_000;
const config = DEFAULT_ATTENTION_CONFIG;

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    pid: 1,
    sessionId: null,
    cwd: null,
    name: null,
    status: 'idle',
    updatedAt: NOW,
    statusUpdatedAt: NOW,
    version: null,
    kind: null,
    messagingSocketPath: null,
    ...overrides,
  };
}

describe('sessionActivity', () => {
  it('busy is active, however long it has been busy', () => {
    expect(sessionActivity(session({ status: 'busy', statusUpdatedAt: NOW - 90 * MINUTE_MS }), NOW, config)).toBe('active');
  });

  it('idle stays active until the waiting-input threshold', () => {
    const idleFor = (ms: number) => sessionActivity(session({ statusUpdatedAt: NOW - ms }), NOW, config);
    expect(idleFor(0)).toBe('active');
    expect(idleFor(config.waitingInputAfterMs - 1)).toBe('active');
    expect(idleFor(config.waitingInputAfterMs)).toBe('inactive');
    expect(idleFor(20 * MINUTE_MS)).toBe('inactive');
  });

  it('honors the configured threshold', () => {
    const custom = { waitingInputAfterMs: MINUTE_MS };
    expect(sessionActivity(session({ statusUpdatedAt: NOW - 2 * MINUTE_MS }), NOW, custom)).toBe('inactive');
  });

  it('idle without a timestamp, shell and unknown status are inactive', () => {
    expect(sessionActivity(session({ statusUpdatedAt: null, updatedAt: null }), NOW, config)).toBe('inactive');
    expect(sessionActivity(session({ status: 'shell' }), NOW, config)).toBe('inactive');
    expect(sessionActivity(session({ status: null }), NOW, config)).toBe('inactive');
  });
});
