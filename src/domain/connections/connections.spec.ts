import { describe, expect, it } from 'vitest';
import { actionsFor, actionsForProblem } from './connection-actions';
import { CONNECTIONS } from './connection';
import { createDefaultConnectionPrefs, parseConnectionPrefs } from './connection-prefs';
import { CONNECTION_PROBLEMS } from './connection-problem';
import { errorStatus } from './connection-status';
import { FIX_FOR } from './fix-action';
import { evaluateGitHubAccount, missingScopes, parseSsoUrl } from './github';

describe('tabela de consertos', () => {
  it('todo problema tem conserto', () => {
    for (const problem of CONNECTION_PROBLEMS) expect(FIX_FOR[problem]).toBeDefined();
  });

  it.each([
    ['keychain-denied', 'retry-permission'],
    ['claude-expired', 'relogin-claude'],
    ['claude-code-missing', 'install-claude-code'],
    ['github-unauthorized', 'relogin-github'],
    ['github-missing-scope', 'regrant-scopes'],
    ['github-org-access', 'authorize-org'],
    ['microsoft-expired', 'relogin-microsoft'],
    ['microsoft-not-connected', 'connect-microsoft'],
    ['notifications-blocked', 'open-system-settings'],
    ['notifications-unverifiable', 'open-system-settings'],
    ['github-not-member', 'open-org-page'],
  ] as const)('%s usa o conserto "%s"', (problem, fix) => {
    expect(FIX_FOR[problem]).toBe(fix);
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
    expect(actionsFor('microsoft', { state: 'disconnected' })).toEqual([{ kind: 'connect', label: 'connect' }]);
    expect(actionsFor('github', { state: 'disconnected' })).toEqual([{ kind: 'connect', label: 'connect-github-cli' }]);
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
    expect(status).toMatchObject({ state: 'error', problem: 'github-missing-scope', note: 'missing-scopes', noteArg: 'read:org' });
  });

  it('SSO pendente e não-membro têm problemas distintos', () => {
    expect(evaluateGitHubAccount({ ...ok, orgAccess: 'sso-required' })).toMatchObject({ problem: 'github-org-access' });
    expect(evaluateGitHubAccount({ ...ok, orgAccess: 'not-member' })).toMatchObject({ problem: 'github-not-member' });
  });

  it('escopos maiores implicam os menores', () => {
    expect(missingScopes({ ...ok, scopes: ['repo', 'admin:org'] })).toEqual([]);
    expect(missingScopes({ ...ok, scopes: ['repo', 'write:org'] })).toEqual([]);
    expect(missingScopes({ ...ok, scopes: ['repo'] })).toEqual(['read:org']);
    expect(missingScopes({ ...ok, scopes: ['read:org'] })).toEqual(['repo']);
    expect(missingScopes({ ...ok, scopes: ['repo'] }, ['repo:status', 'public_repo'])).toEqual([]);
    expect(missingScopes({ ...ok, scopes: ['read:org'] }, ['write:org'])).toEqual(['write:org']);
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

describe('parseSsoUrl', () => {
  it('extrai a URL https de github.com do header', () => {
    expect(parseSsoUrl('required; url=https://github.com/orgs/Mottu-ops/sso?authorization_request=ABC')).toBe(
      'https://github.com/orgs/Mottu-ops/sso?authorization_request=ABC',
    );
  });

  it('recusa header ausente, sem url, http, outro host e lixo', () => {
    for (const header of [
      null,
      'required',
      'required; url=http://github.com/orgs/x/sso',
      'required; url=https://evil.example/orgs/x/sso',
      'required; url=https://github.com.evil.example/sso',
      'required; url=https://user@github.com/sso',
      'required; url=javascript:alert(1)',
      'required; url=nao-e-url',
    ]) {
      expect(parseSsoUrl(header)).toBeNull();
    }
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
    expect(actionsForProblem('microsoft', 'microsoft-not-connected')).toEqual([{ kind: 'connect', label: 'connect' }]);
  });
});
