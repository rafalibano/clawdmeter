import { describe, expect, it } from 'vitest';
import { Localizer } from '../../i18n';
import type { SessionsData } from '../../../application/use-cases';
import { DEFAULT_ATTENTION_CONFIG, type ClaudeSession, type SessionUsage } from '../../../domain/sessions';
import { MINUTE_MS, SECOND_MS } from '../../../domain/time';
import { filterForKey, toSessionsView as toSessionsViewWith, type SessionsFilter } from './sessions-view';

const NOW = 1_800_000_000_000;

function session(pid: number, overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    pid,
    sessionId: null,
    cwd: '/Users/dev/code/orders-api',
    name: null,
    status: 'busy',
    updatedAt: NOW,
    statusUpdatedAt: NOW,
    version: null,
    kind: null,
    messagingSocketPath: null,
    ...overrides,
  };
}

const data = (sessions: ClaudeSession[], usage: ReadonlyMap<number, SessionUsage> = new Map()): SessionsData => ({
  at: NOW,
  sessions,
  attention: DEFAULT_ATTENTION_CONFIG,
  usage,
});

function usage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return {
    model: 'claude-opus-5-5',
    contextTokens: 412_300,
    longContext: false,
    inputTokens: 18_400,
    outputTokens: 96_200,
    cacheReadTokens: 6_810_000,
    cacheCreationTokens: 402_000,
    subagents: [],
    ...overrides,
  };
}

const PT = new Localizer('pt-BR');
const toSessionsView = (data: Parameters<typeof toSessionsViewWith>[0]) => toSessionsViewWith(data, PT);

describe('toSessionsView', () => {
  it('shows name, short folder, status and how long ago', () => {
    const { rows } = toSessionsView(data([session(1, { name: 'refactor', statusUpdatedAt: NOW - 12 * MINUTE_MS })]));
    expect(rows[0]).toMatchObject({
      key: '1',
      title: 'refactor',
      cwd: 'code/orders-api',
      status: 'busy',
      statusLabel: 'Trabalhando',
      since: 'há 12 min',
      attention: null,
      attentionLabel: null,
    });
  });

  it('without a name uses the folder; without a time shows a dash; unknown status', () => {
    const { rows } = toSessionsView(data([session(2, { status: null, statusUpdatedAt: null, updatedAt: null })]));
    expect(rows[0]).toMatchObject({ title: 'orders-api', since: '—', status: 'unknown', statusLabel: 'Desconhecido' });
  });

  it('highlights a session idle for a long time', () => {
    const { rows, summary } = toSessionsView(
      data([session(3, { status: 'idle', statusUpdatedAt: NOW - 18 * MINUTE_MS }), session(4)]),
    );
    expect(rows[0]).toMatchObject({ attention: 'waiting-input', attentionLabel: 'Aguardando input há 18 min' });
    expect(rows[1]?.attention).toBeNull();
    expect(summary).toBe('2 sessões · 1 pede atenção');
  });

  it('highlights a session busy for a long time', () => {
    const { rows } = toSessionsView(data([session(5, { statusUpdatedAt: NOW - 45 * MINUTE_MS })]));
    expect(rows[0]).toMatchObject({ attention: 'running-long', attentionLabel: 'Ocupada há 45 min' });
  });

  it('summary: empty, singular and without attention', () => {
    expect(toSessionsView(data([])).summary).toBe('Nenhuma sessão do Claude Code aberta.');
    expect(toSessionsView(data([session(6)])).summary).toBe('1 sessão');
  });

  it('a session without usage has no model, context or details', () => {
    const { rows } = toSessionsView(data([session(7)]));
    expect(rows[0]).toMatchObject({ model: null, context: null, contextLevel: null, details: null });
  });

  it('shows the short model and the context against the window with its percentage', () => {
    const { rows } = toSessionsView(data([session(8)], new Map([[8, usage()]])));
    expect(rows[0]).toMatchObject({ model: 'opus-5-5', context: 'Contexto 412k / 1M · 41%', contextLevel: 'ok' });
  });

  it('a model outside the table shows only the used context, without percentage or level', () => {
    const { rows } = toSessionsView(data([session(9)], new Map([[9, usage({ model: 'local-llm' })]])));
    expect(rows[0]).toMatchObject({ model: 'local-llm', context: 'Contexto 412k', contextLevel: null });
  });

  it('without a reply yet there is no context line', () => {
    const { rows } = toSessionsView(data([session(10)], new Map([[10, usage({ model: null, contextTokens: null })]])));
    expect(rows[0]).toMatchObject({ model: null, context: null, contextLevel: null });
    expect(rows[0]?.details).not.toBeNull();
  });

  it('context level: warning from 70% and critical from 90%', () => {
    const level = (contextTokens: number, longContext = false) =>
      toSessionsView(data([session(11)], new Map([[11, usage({ model: 'claude-sonnet-4-5', contextTokens, longContext })]])))
        .rows[0]?.contextLevel;
    expect(level(139_000)).toBe('ok');
    expect(level(140_000)).toBe('warning');
    expect(level(180_000)).toBe('critical');
    expect(level(180_000, true)).toBe('ok');
  });

  it('details: the four token counters and the running subagents with model and time alive', () => {
    const { rows } = toSessionsView(
      data(
        [session(12)],
        new Map([
          [
            12,
            usage({
              subagents: [
                { id: 'agent-a', agentType: 'Explore', model: 'claude-haiku-5-5', startedAt: NOW - 4 * MINUTE_MS },
                { id: 'agent-b', agentType: null, model: null, startedAt: null },
                { id: 'agent-c', agentType: 'claude', model: 'opus', startedAt: NOW - 20 * SECOND_MS },
              ],
            }),
          ],
        ]),
      ),
    );
    expect(rows[0]?.details).toEqual({
      tokens: [
        { label: 'Entrada', value: '18k' },
        { label: 'Saída', value: '96k' },
        { label: 'Cache lido', value: '6,8M' },
        { label: 'Cache gravado', value: '402k' },
      ],
      subagents: [
        { key: 'agent-a', type: 'Explore', model: 'haiku-5-5', alive: '4 min' },
        { key: 'agent-b', type: 'desconhecido', model: 'desconhecido', alive: '—' },
        { key: 'agent-c', type: 'claude', model: 'opus', alive: 'menos de 1 min' },
      ],
    });
  });
});

describe('sessions filter', () => {
  const mixed = data([
    session(1),
    session(2, { status: 'idle', statusUpdatedAt: NOW - 18 * MINUTE_MS }),
    session(3, { status: 'shell' }),
    session(4, { status: null }),
    session(5),
    session(6, { status: 'idle', statusUpdatedAt: NOW - MINUTE_MS }),
  ]);
  const filtered = (filter: SessionsFilter, input = mixed) => toSessionsViewWith(input, PT, filter);

  it('defaults to all and counts each option over every session', () => {
    const view = toSessionsView(mixed);
    expect(view.rows.map((row) => row.key)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(view.filters).toEqual([
      { id: 'all', label: 'Todas', count: 6, selected: true },
      { id: 'active', label: 'Ativas', count: 3, selected: false },
      { id: 'inactive', label: 'Inativas', count: 3, selected: false },
    ]);
  });

  it('active keeps busy and recently idle sessions and the summary counts the visible rows', () => {
    const view = filtered('active');
    expect(view.rows.map((row) => row.key)).toEqual(['1', '5', '6']);
    expect(view.rows.every((row) => row.activity === 'active')).toBe(true);
    expect(view.summary).toBe('3 sessões');
    expect(view.filters.find((option) => option.selected)?.id).toBe('active');
    expect(view.filters.map((option) => option.count)).toEqual([6, 3, 3]);
  });

  it('sessionKeys lists every session, not only the visible ones', () => {
    expect(filtered('active').sessionKeys).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('inactive keeps long idle, shell and unknown status', () => {
    const view = filtered('inactive');
    expect(view.rows.map((row) => row.key)).toEqual(['2', '3', '4']);
    expect(view.summary).toBe('3 sessões · 1 pede atenção');
  });

  it('a filter with no match shows its own empty message', () => {
    const busyOnly = data([session(1)]);
    const idleOnly = data([session(2, { status: 'idle', statusUpdatedAt: NOW - 18 * MINUTE_MS })]);
    expect(filtered('inactive', busyOnly)).toMatchObject({ rows: [], summary: 'Nenhuma sessão inativa.' });
    expect(filtered('active', idleOnly)).toMatchObject({ rows: [], summary: 'Nenhuma sessão ativa.' });
    expect(filtered('all', data([])).summary).toBe('Nenhuma sessão do Claude Code aberta.');
  });

  it('filterForKey: arrows cycle both ways, Home and End jump to the ends, other keys do nothing', () => {
    expect(filterForKey('all', 'ArrowRight')).toBe('active');
    expect(filterForKey('inactive', 'ArrowDown')).toBe('all');
    expect(filterForKey('all', 'ArrowLeft')).toBe('inactive');
    expect(filterForKey('inactive', 'ArrowUp')).toBe('active');
    expect(filterForKey('active', 'Home')).toBe('all');
    expect(filterForKey('active', 'End')).toBe('inactive');
    expect(filterForKey('active', 'Enter')).toBeNull();
  });
});
