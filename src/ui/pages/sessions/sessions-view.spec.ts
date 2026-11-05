import { describe, expect, it } from 'vitest';
import { Localizer } from '../../i18n';
import type { SessionsData } from '../../../application/use-cases';
import { DEFAULT_ATTENTION_CONFIG, type ClaudeSession } from '../../../domain/sessions';
import { MINUTE_MS } from '../../../domain/time';
import { toSessionsView as toSessionsViewWith } from './sessions-view';

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

const data = (sessions: ClaudeSession[]): SessionsData => ({ at: NOW, sessions, attention: DEFAULT_ATTENTION_CONFIG });

const PT = new Localizer('pt-BR');
const toSessionsView = (data: Parameters<typeof toSessionsViewWith>[0]) => toSessionsViewWith(data, PT);

describe('toSessionsView', () => {
  it('mostra nome, pasta curta, status e há quanto tempo', () => {
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

  it('sem nome usa a pasta; sem horário mostra traço; status desconhecido', () => {
    const { rows } = toSessionsView(data([session(2, { status: null, statusUpdatedAt: null, updatedAt: null })]));
    expect(rows[0]).toMatchObject({ title: 'orders-api', since: '—', status: 'unknown', statusLabel: 'Desconhecido' });
  });

  it('destaca sessão ociosa há muito tempo', () => {
    const { rows, summary } = toSessionsView(
      data([session(3, { status: 'idle', statusUpdatedAt: NOW - 18 * MINUTE_MS }), session(4)]),
    );
    expect(rows[0]).toMatchObject({ attention: 'waiting-input', attentionLabel: 'Aguardando input há 18 min' });
    expect(rows[1]?.attention).toBeNull();
    expect(summary).toBe('2 sessões · 1 pede atenção');
  });

  it('destaca sessão ocupada há muito tempo', () => {
    const { rows } = toSessionsView(data([session(5, { statusUpdatedAt: NOW - 45 * MINUTE_MS })]));
    expect(rows[0]).toMatchObject({ attention: 'running-long', attentionLabel: 'Ocupada há 45 min' });
  });

  it('resumo: vazio, singular e sem atenção', () => {
    expect(toSessionsView(data([])).summary).toBe('Nenhuma sessão do Claude Code aberta.');
    expect(toSessionsView(data([session(6)])).summary).toBe('1 sessão');
  });
});
