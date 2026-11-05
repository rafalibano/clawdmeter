import { describe, expect, it } from 'vitest';
import { actionsFor, actionsForProblem } from './connection-actions';
import { CONNECTIONS } from './connection';
import { createDefaultConnectionPrefs, parseConnectionPrefs } from './connection-prefs';
import { CONNECTION_PROBLEMS } from './connection-problem';
import { errorStatus } from './connection-status';
import { FIX_FOR, FIX_LABELS, PROBLEM_MESSAGES } from './fix-action';
import { evaluateGitHubAccount, missingScopes } from './github';

describe('tabela de consertos', () => {
  it('todo problema tem conserto, rótulo e mensagem', () => {
    for (const problem of CONNECTION_PROBLEMS) {
      expect(FIX_FOR[problem]).toBeDefined();
      expect(FIX_LABELS[FIX_FOR[problem]]).not.toBe('');
      expect(PROBLEM_MESSAGES[problem]).not.toBe('');
    }
  });

  it.each([
    ['keychain-denied', 'Refazer permissão'],
    ['claude-expired', 'Refazer login do Claude'],
    ['claude-code-missing', 'Instalar Claude Code'],
    ['github-unauthorized', 'Refazer login do GitHub'],
    ['github-missing-scope', 'Refazer permissões'],
    ['github-org-access', 'Autorizar na org'],
    ['microsoft-expired', 'Refazer login da Microsoft'],
    ['microsoft-not-connected', 'Conectar'],
    ['notifications-blocked', 'Abrir ajustes do sistema'],
  ] as const)('%s mostra o botão "%s"', (problem, label) => {
    expect(FIX_LABELS[FIX_FOR[problem]]).toBe(label);
  });
});

describe('actionsFor', () => {
  it('nenhum estado de erro fica sem botão de conserto', () => {
    for (const connection of CONNECTIONS) {
      for (const problem of CONNECTION_PROBLEMS) {
        const actions = actionsFor(connection.id, errorStatus(problem));
        expect(actions.some((action) => action.kind === 'fix')).toBe(true);
      }
    }
  });

  it('toda conexão desconectável oferece Desconectar quando conectada ou com erro', () => {
    for (const connection of CONNECTIONS.filter((item) => item.disconnectable)) {
      expect(actionsFor(connection.id, { state: 'connected' }).map((a) => a.kind)).toContain('disconnect');
      expect(actionsFor(connection.id, errorStatus('unexpected')).map((a) => a.kind)).toContain('disconnect');
    }
  });

  it('notificações não têm Desconectar', () => {
    expect(actionsFor('notifications', { state: 'connected' })).toEqual([]);
    expect(actionsFor('notifications', errorStatus('notifications-blocked')).map((a) => a.kind)).not.toContain(
      'disconnect',
    );
  });

  it('desconectada oferece Conectar; checando não oferece nada', () => {
    expect(actionsFor('github', { state: 'disconnected' })).toEqual([{ kind: 'connect', label: 'Conectar' }]);
    expect(actionsFor('github', { state: 'checking' })).toEqual([]);
  });

  it('o conserto genérico não duplica o "Verificar de novo"', () => {
    expect(actionsFor('claude', errorStatus('unexpected')).map((a) => a.kind)).toEqual(['fix', 'disconnect']);
    expect(actionsFor('claude', errorStatus('claude-expired')).map((a) => a.kind)).toEqual([
      'fix',
      'recheck',
      'disconnect',
    ]);
  });
});

describe('evaluateGitHubAccount', () => {
  const ok = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'ok' as const };

  it('conectado quando escopos e org estão ok', () => {
    expect(evaluateGitHubAccount(ok)).toEqual({ state: 'connected', account: 'dev' });
  });

  it('escopo faltando', () => {
    const status = evaluateGitHubAccount({ ...ok, scopes: ['repo'] });
    expect(status).toMatchObject({ state: 'error', problem: 'github-missing-scope' });
  });

  it('SSO pendente e não-membro caem em org', () => {
    expect(evaluateGitHubAccount({ ...ok, orgAccess: 'sso-required' })).toMatchObject({ problem: 'github-org-access' });
    expect(evaluateGitHubAccount({ ...ok, orgAccess: 'not-member' })).toMatchObject({ problem: 'github-org-access' });
  });

  it('escopos desconhecidos (token fine-grained) não bloqueiam', () => {
    expect(missingScopes({ ...ok, scopes: null })).toEqual([]);
    expect(evaluateGitHubAccount({ ...ok, scopes: null })).toMatchObject({ state: 'connected' });
  });
});

describe('parseConnectionPrefs', () => {
  it('usa os padrões para lixo', () => {
    expect(parseConnectionPrefs(undefined)).toEqual(createDefaultConnectionPrefs());
    expect(parseConnectionPrefs('x')).toEqual(createDefaultConnectionPrefs());
    expect(parseConnectionPrefs({ github: { method: 'telepatia' } }).github.method).toBeNull();
  });

  it('preserva valores válidos', () => {
    const prefs = parseConnectionPrefs({
      claude: { enabled: false },
      github: { method: 'pat' },
      microsoft: { account: 'a@b.c' },
    });
    expect(prefs).toEqual({ claude: { enabled: false }, github: { method: 'pat' }, microsoft: { account: 'a@b.c' } });
  });
});

describe('actionsForProblem', () => {
  it('nunca oferece Desconectar e sempre tem um botão de conserto', () => {
    for (const problem of CONNECTION_PROBLEMS) {
      const actions = actionsForProblem('microsoft', problem);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.map((action) => action.kind)).not.toContain('disconnect');
    }
  });

  it('Microsoft nunca conectada oferece só Conectar', () => {
    expect(actionsForProblem('microsoft', 'microsoft-not-connected')).toEqual([{ kind: 'connect', label: 'Conectar' }]);
  });
});
