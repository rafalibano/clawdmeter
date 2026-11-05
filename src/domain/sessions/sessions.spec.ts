import { describe, expect, it } from 'vitest';
import { MINUTE_MS } from '../time';
import { DEFAULT_ATTENTION_CONFIG, sessionAttention, sortSessions } from './attention';
import { parseSession, parseSessionFile, sessionTitle, shortCwd, statusSince, type ClaudeSession } from './claude-session';

const NOW = 1_800_000_000_000;

function session(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    pid: 100,
    sessionId: 's',
    cwd: '/Users/dev/code/orders-api',
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

describe('parseSession', () => {
  it('lê todos os campos conhecidos', () => {
    const parsed = parseSession({
      pid: 4242,
      sessionId: 'abc',
      cwd: '/Users/dev/code/orders-api',
      name: 'refactor',
      status: 'busy',
      updatedAt: NOW,
      statusUpdatedAt: NOW - 1_000,
      version: '2.1.318',
      kind: 'interactive',
      messagingSocketPath: '/tmp/x.sock',
    });
    expect(parsed).toEqual({
      pid: 4242,
      sessionId: 'abc',
      cwd: '/Users/dev/code/orders-api',
      name: 'refactor',
      status: 'busy',
      updatedAt: NOW,
      statusUpdatedAt: NOW - 1_000,
      version: '2.1.318',
      kind: 'interactive',
      messagingSocketPath: '/tmp/x.sock',
    });
  });

  it('é tolerante: campos ausentes, extras, status desconhecido e tempos em segundos ou ISO', () => {
    const parsed = parseSession({
      pid: '77',
      status: 'compacting',
      updatedAt: 1_800_000_000,
      statusUpdatedAt: '2026-11-05T10:00:00Z',
      surprise: { a: 1 },
    });
    expect(parsed).toMatchObject({
      pid: 77,
      status: null,
      name: null,
      cwd: null,
      updatedAt: 1_800_000_000_000,
      statusUpdatedAt: Date.parse('2026-11-05T10:00:00Z'),
    });
  });

  it('exige pid válido', () => {
    expect(parseSession({ status: 'idle' })).toBeNull();
    expect(parseSession({ pid: 0 })).toBeNull();
    expect(parseSession({ pid: 1.5 })).toBeNull();
    expect(parseSession(null)).toBeNull();
    expect(parseSession([])).toBeNull();
  });

  it('parseSessionFile ignora JSON inválido', () => {
    expect(parseSessionFile('{ quebrado')).toBeNull();
    expect(parseSessionFile('{"pid": 5}')?.pid).toBe(5);
  });
});

describe('apresentação', () => {
  it('shortCwd mostra os dois últimos segmentos, em POSIX e Windows', () => {
    expect(shortCwd('/Users/dev/code/orders-api')).toBe('code/orders-api');
    expect(shortCwd('C:\\Users\\dev\\code\\orders-api')).toBe('code/orders-api');
    expect(shortCwd('/')).toBe('/');
    expect(shortCwd(null)).toBe('—');
  });

  it('título: nome, senão a pasta, senão o pid', () => {
    expect(sessionTitle(session({ name: 'refactor' }))).toBe('refactor');
    expect(sessionTitle(session())).toBe('orders-api');
    expect(sessionTitle(session({ cwd: null }))).toBe('pid 100');
  });

  it('statusSince prefere statusUpdatedAt', () => {
    expect(statusSince(session({ statusUpdatedAt: 5, updatedAt: 9 }))).toBe(5);
    expect(statusSince(session({ statusUpdatedAt: null, updatedAt: 9 }))).toBe(9);
  });
});

describe('sessionAttention', () => {
  const config = DEFAULT_ATTENTION_CONFIG;

  it('idle há mais que o limiar: aguardando input', () => {
    expect(sessionAttention(session({ statusUpdatedAt: NOW - 6 * MINUTE_MS }), NOW, config)).toBe('waiting-input');
    expect(sessionAttention(session({ statusUpdatedAt: NOW - 4 * MINUTE_MS }), NOW, config)).toBeNull();
  });

  it('busy há muito tempo: rodando há muito', () => {
    expect(sessionAttention(session({ status: 'busy', statusUpdatedAt: NOW - 31 * MINUTE_MS }), NOW, config)).toBe('running-long');
    expect(sessionAttention(session({ status: 'busy', statusUpdatedAt: NOW - 10 * MINUTE_MS }), NOW, config)).toBeNull();
  });

  it('shell, status desconhecido ou sem horário nunca chamam atenção', () => {
    expect(sessionAttention(session({ status: 'shell', statusUpdatedAt: 0 }), NOW, config)).toBeNull();
    expect(sessionAttention(session({ status: null }), NOW, config)).toBeNull();
    expect(sessionAttention(session({ statusUpdatedAt: null, updatedAt: null }), NOW, config)).toBeNull();
  });

  it('respeita o limiar configurado', () => {
    const custom = { waitingInputAfterMs: MINUTE_MS, runningLongAfterMs: MINUTE_MS };
    expect(sessionAttention(session({ statusUpdatedAt: NOW - 2 * MINUTE_MS }), NOW, custom)).toBe('waiting-input');
  });
});

describe('sortSessions', () => {
  it('atenção primeiro, depois a mais recente', () => {
    const fresh = session({ pid: 1, statusUpdatedAt: NOW - MINUTE_MS });
    const newest = session({ pid: 2, status: 'busy', statusUpdatedAt: NOW });
    const waiting = session({ pid: 3, statusUpdatedAt: NOW - 20 * MINUTE_MS });
    expect(sortSessions([fresh, newest, waiting], NOW, DEFAULT_ATTENTION_CONFIG).map((s) => s.pid)).toEqual([3, 2, 1]);
  });
});
