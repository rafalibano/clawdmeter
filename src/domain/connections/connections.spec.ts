import { describe, expect, it } from 'vitest';
import { actionsFor, actionsForProblem } from './connection-actions';
import { CONNECTIONS } from './connection';
import { createDefaultConnectionPrefs, parseConnectionPrefs } from './connection-prefs';
import { CONNECTION_PROBLEMS } from './connection-problem';
import { errorStatus } from './connection-status';
import { FIX_FOR } from './fix-action';
import { evaluateGitHubAccount, missingScopes, parseSsoUrl } from './github';

describe('fix table', () => {
  it('every problem has a fix', () => {
    for (const problem of CONNECTION_PROBLEMS) expect(FIX_FOR[problem]).toBeDefined();
  });

  it.each([
    ['keychain-denied', 'retry-permission'],
    ['keyring-unavailable', 'use-github-cli'],
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
  it('no error state is left without a fix button', () => {
    for (const connection of CONNECTIONS) {
      for (const problem of CONNECTION_PROBLEMS) {
        const actions = actionsFor(connection.id, errorStatus(problem));
        expect(actions.some((action) => action.kind === 'fix')).toBe(true);
      }
    }
  });

  it('every disconnectable connection offers Disconnect when connected or in error', () => {
    for (const connection of CONNECTIONS.filter((item) => item.disconnectable)) {
      expect(actionsFor(connection.id, { state: 'connected' }).map((a) => a.kind)).toContain('disconnect');
      expect(actionsFor(connection.id, errorStatus('unexpected')).map((a) => a.kind)).toContain('disconnect');
    }
  });

  it('notifications have no Disconnect', () => {
    expect(actionsFor('notifications', { state: 'connected' })).toEqual([]);
    expect(actionsFor('notifications', errorStatus('notifications-blocked')).map((a) => a.kind)).not.toContain(
      'disconnect',
    );
  });

  it('disconnected offers Connect; checking offers nothing', () => {
    expect(actionsFor('microsoft', { state: 'disconnected' })).toEqual([{ kind: 'connect', label: 'connect' }]);
    expect(actionsFor('github', { state: 'disconnected' })).toEqual([{ kind: 'connect', label: 'connect-github-cli' }]);
    expect(actionsFor('github', { state: 'checking' })).toEqual([]);
  });

  it('the generic fix does not duplicate "Check again"', () => {
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

  it('connected when scopes and org are ok', () => {
    expect(evaluateGitHubAccount(ok)).toEqual({ state: 'connected', account: 'dev' });
  });

  it('missing scope', () => {
    const status = evaluateGitHubAccount({ ...ok, scopes: ['repo'] });
    expect(status).toMatchObject({ state: 'error', problem: 'github-missing-scope', note: 'missing-scopes', noteArg: 'read:org' });
  });

  it('pending SSO and non-member have distinct problems', () => {
    expect(evaluateGitHubAccount({ ...ok, orgAccess: 'sso-required' })).toMatchObject({ problem: 'github-org-access' });
    expect(evaluateGitHubAccount({ ...ok, orgAccess: 'not-member' })).toMatchObject({ problem: 'github-not-member' });
  });

  it('larger scopes imply the smaller ones', () => {
    expect(missingScopes({ ...ok, scopes: ['repo', 'admin:org'] })).toEqual([]);
    expect(missingScopes({ ...ok, scopes: ['repo', 'write:org'] })).toEqual([]);
    expect(missingScopes({ ...ok, scopes: ['repo'] })).toEqual(['read:org']);
    expect(missingScopes({ ...ok, scopes: ['read:org'] })).toEqual(['repo']);
    expect(missingScopes({ ...ok, scopes: ['repo'] }, ['repo:status', 'public_repo'])).toEqual([]);
    expect(missingScopes({ ...ok, scopes: ['read:org'] }, ['write:org'])).toEqual(['write:org']);
  });

  it('unknown scopes (fine-grained token) do not block', () => {
    expect(missingScopes({ ...ok, scopes: null })).toEqual([]);
    expect(evaluateGitHubAccount({ ...ok, scopes: null })).toMatchObject({ state: 'connected' });
  });
});

describe('parseConnectionPrefs', () => {
  it('uses the defaults for garbage', () => {
    expect(parseConnectionPrefs(undefined)).toEqual(createDefaultConnectionPrefs());
    expect(parseConnectionPrefs('x')).toEqual(createDefaultConnectionPrefs());
    expect(parseConnectionPrefs({ github: { method: 'telepatia' } }).github.method).toBeNull();
  });

  it('preserves valid values', () => {
    const prefs = parseConnectionPrefs({
      claude: { enabled: false },
      github: { method: 'pat' },
      microsoft: { account: 'a@b.c' },
    });
    expect(prefs).toEqual({ claude: { enabled: false }, github: { method: 'pat' }, microsoft: { account: 'a@b.c' } });
  });
});

describe('parseSsoUrl', () => {
  it('extracts the https github.com URL from the header', () => {
    expect(parseSsoUrl('required; url=https://github.com/orgs/Mottu-ops/sso?authorization_request=ABC')).toBe(
      'https://github.com/orgs/Mottu-ops/sso?authorization_request=ABC',
    );
  });

  it('rejects a missing header, no url, http, another host and garbage', () => {
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
  it('never offers Disconnect and always has a fix button', () => {
    for (const problem of CONNECTION_PROBLEMS) {
      const actions = actionsForProblem('microsoft', problem);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.map((action) => action.kind)).not.toContain('disconnect');
    }
  });

  it('Microsoft never connected offers only Connect', () => {
    expect(actionsForProblem('microsoft', 'microsoft-not-connected')).toEqual([{ kind: 'connect', label: 'connect' }]);
  });
});
