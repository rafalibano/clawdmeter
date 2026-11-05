import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_INSTALL_URL,
  ConnectionProblemError,
  GITHUB_ORG_SSO_URL,
  GITHUB_ORG_URL,
  actionsFor,
  type ConnectionId,
  type ConnectionStatus,
  type FixAction,
} from '../../../domain/connections';
import { createConnections, type Connections } from '../../connections/create-connections';
import { SECRET_KEYS } from '../../ports';
import { FakeClock } from '../../testing/fake-clock';
import { DEVICE_CODE, createFakeConnectionWorld, type FakeConnectionWorld } from '../../testing/fake-connection-adapters';

let world: FakeConnectionWorld;
let clock: FakeClock;
let connections: Connections;

beforeEach(async () => {
  world = createFakeConnectionWorld();
  clock = new FakeClock();
  await clock.advance(10_000);
  connections = createConnections(world.adapters, clock);
});

function fixLabel(id: ConnectionId, status: ConnectionStatus): string | undefined {
  const action = actionsFor(id, status).find((item) => item.kind === 'fix');
  return action?.kind === 'fix' ? action.label : undefined;
}

async function runFix(id: ConnectionId, fix: FixAction): Promise<ConnectionStatus> {
  return connections.fix.execute(id, fix);
}

describe('Claude', () => {
  it('connects with the Claude Code credential and shows the plan', async () => {
    expect(await connections.check.execute('claude')).toEqual({ state: 'connected', detail: 'Plano max' });
  });

  it('never writes or deletes the credential (read only)', async () => {
    await connections.check.execute('claude');
    await connections.disconnect.execute('claude');
    expect(world.secrets.values.size).toBe(0);
    expect(world.claude.reads).toBe(1);
  });

  it('keychain denied -> "Redo permission" -> re-reading connects', async () => {
    world.claude.outcome = new ConnectionProblemError('keychain-denied');
    const status = await connections.check.execute('claude');
    expect(status).toMatchObject({ state: 'error', problem: 'keychain-denied' });
    expect(fixLabel('claude', status)).toBe('retry-permission');
    world.claude.outcome = { expiresAt: null, subscriptionType: null };
    expect(await runFix('claude', 'retry-permission')).toEqual({ state: 'connected' });
  });

  it('expired token -> "Sign in to Claude again" opens the terminal with /login', async () => {
    world.claude.outcome = { expiresAt: 5_000, subscriptionType: 'pro' };
    const status = await connections.check.execute('claude');
    expect(status).toMatchObject({ problem: 'claude-expired' });
    expect(fixLabel('claude', status)).toBe('relogin-claude');
    const after = await runFix('claude', 'relogin-claude');
    expect(world.terminal.commands).toEqual([{ program: 'claude', args: ['/login'] }]);
    expect(after).toMatchObject({ state: 'error', problem: 'claude-expired' });
  });

  it('Claude Code missing -> "Install Claude Code" opens the install page', async () => {
    world.claude.outcome = new ConnectionProblemError('claude-code-missing');
    const status = await connections.check.execute('claude');
    expect(fixLabel('claude', status)).toBe('install-claude-code');
    await runFix('claude', 'install-claude-code');
    expect(world.urls.opened).toEqual([CLAUDE_CODE_INSTALL_URL]);
  });

  it('a 401 reported by a gateway marks the connection as expired', () => {
    connections.report.execute('claude', 'claude-expired');
    expect(connections.monitor.get('claude')).toMatchObject({ problem: 'claude-expired' });
  });

  it('Disconnect stops using the credential and Connect reads it again', async () => {
    await connections.connect.execute('claude');
    expect(await connections.disconnect.execute('claude')).toEqual({ state: 'disconnected' });
    expect(await connections.check.execute('claude')).toEqual({ state: 'disconnected' });
    expect(world.claude.reads).toBe(1);
    expect(await connections.connect.execute('claude')).toMatchObject({ state: 'connected' });
  });
});

describe('GitHub', () => {
  it('with no connection made, starts disconnected', async () => {
    expect(await connections.check.execute('github')).toEqual({ state: 'disconnected' });
  });

  it('connects through the gh CLI without storing the token', async () => {
    const status = await connections.connect.execute('github');
    expect(status).toEqual({ state: 'connected', account: 'dev' });
    expect(world.prefs.current.github.method).toBe('gh-cli');
    expect(world.secrets.values.size).toBe(0);
    expect(world.githubAccounts.inspected).toEqual(['gh-token']);
  });

  it('gh installed without login: connect hint and "Connect GitHub CLI" button', async () => {
    world.githubCli.outcome = { missing: 'not-logged-in' };
    const status = await connections.connect.execute('github');
    expect(status).toEqual({
      state: 'disconnected',
      note: 'github-cli-not-logged-in',
      cli: 'not-logged-in',
    });
    expect(actionsFor('github', status).map((a) => a.label)).toEqual(['connect-github-cli']);
    expect(world.prefs.current.github.method).toBeNull();
  });

  it('gh not installed: install hint and "Install GitHub CLI" button', async () => {
    world.githubCli.outcome = { missing: 'not-installed' };
    const status = await connections.connect.execute('github');
    expect(status).toEqual({
      state: 'disconnected',
      note: 'github-cli-not-installed',
      cli: 'not-installed',
    });
    expect(actionsFor('github', status).map((a) => a.label)).toEqual(['install-github-cli']);
  });

  it('the check without a method shows the gh reason right on open', async () => {
    world.githubCli.outcome = { missing: 'not-installed' };
    expect(await connections.check.execute('github')).toMatchObject({ state: 'disconnected', cli: 'not-installed' });
    world.githubCli.outcome = { missing: 'not-logged-in' };
    expect(await connections.check.execute('github')).toMatchObject({ state: 'disconnected', cli: 'not-logged-in' });
    world.githubCli.outcome = new Error('timeout');
    expect(await connections.check.execute('github')).toEqual({ state: 'disconnected' });
  });

  it('"Connect GitHub CLI" opens the terminal with gh auth login and "Check again" connects', async () => {
    world.githubCli.outcome = { missing: 'not-logged-in' };
    const opened = await runFix('github', 'connect-github-cli');
    expect(world.terminal.commands).toEqual([{ program: 'gh', args: ['auth', 'login', '-h', 'github.com', '-w'] }]);
    expect(opened).toMatchObject({ state: 'disconnected', cli: 'login-opened' });
    expect(actionsFor('github', opened).map((a) => a.label)).toEqual(['connect-github-cli', 'recheck']);
    world.githubCli.outcome = 'gh-token';
    expect(await connections.connect.execute('github')).toEqual({ state: 'connected', account: 'dev' });
  });

  it('"Install GitHub CLI" opens cli.github.com and then asks to check again', async () => {
    world.githubCli.outcome = { missing: 'not-installed' };
    const opened = await runFix('github', 'install-github-cli');
    expect(world.urls.opened).toEqual(['https://cli.github.com']);
    expect(opened).toMatchObject({ state: 'disconnected', cli: 'install-opened' });
    expect(actionsFor('github', opened).map((a) => a.label)).toEqual(['install-github-cli', 'recheck']);
    world.githubCli.outcome = { missing: 'not-logged-in' };
    expect(await connections.connect.execute('github')).toMatchObject({ cli: 'not-logged-in' });
  });

  it('Device Flow opens the verification page, stores the token in the keychain and connects', async () => {
    const code = await connections.github.startDeviceFlow.execute();
    expect(code).toEqual(DEVICE_CODE);
    const status = await connections.github.completeDeviceFlow.execute(DEVICE_CODE);
    expect(world.urls.opened).toEqual([DEVICE_CODE.verificationUri]);
    expect(status).toEqual({ state: 'connected', account: 'dev' });
    expect(world.secrets.values.get(SECRET_KEYS.githubToken)).toBe('device-token');
    expect(world.prefs.current.github.method).toBe('device-flow');
    expect(await connections.check.execute('github')).toMatchObject({ state: 'connected' });
  });

  it('a failing start (placeholder client_id) becomes an error state with a button, does not swallow the error', async () => {
    world.deviceFlow.startOutcome = new ConnectionProblemError('unexpected', 'GitHub OAuth App client_id not configured');
    expect(await connections.github.startDeviceFlow.execute()).toBeNull();
    const status = connections.monitor.get('github');
    expect(status).toEqual({
      state: 'error',
      problem: 'unexpected',
      message: 'GitHub OAuth App client_id not configured',
    });
    expect(fixLabel('github', status)).toBe('retry');
  });

  it('failing to open the verification page also becomes an error state', async () => {
    world.urls.open = async () => {
      throw new Error('no browser');
    };
    const status = await connections.github.completeDeviceFlow.execute(DEVICE_CODE);
    expect(status).toEqual({ state: 'error', problem: 'unexpected', message: 'no browser' });
    expect(world.secrets.values.size).toBe(0);
  });

  it('cancelling the Device Flow goes back to disconnected without saving anything', async () => {
    world.deviceFlow.waitForAbort = true;
    const controller = new AbortController();
    const pending = connections.github.completeDeviceFlow.execute(DEVICE_CODE, controller.signal);
    await Promise.resolve();
    expect(connections.monitor.get('github').state).toBe('checking');
    controller.abort();
    expect(await pending).toEqual({ state: 'disconnected' });
    expect(connections.monitor.get('github')).toEqual({ state: 'disconnected' });
    expect(world.secrets.values.size).toBe(0);
    expect(world.prefs.current.github.method).toBeNull();
  });

  it('cancelling after receiving the token, before saving, discards the result', async () => {
    const controller = new AbortController();
    world.githubAccounts.inspect = async () => {
      controller.abort();
      return { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'ok' };
    };
    expect(await connections.github.completeDeviceFlow.execute(DEVICE_CODE, controller.signal)).toEqual({
      state: 'disconnected',
    });
    expect(world.secrets.values.size).toBe(0);
    expect(world.prefs.current.github.method).toBeNull();
  });

  it('a denied Device Flow saves nothing', async () => {
    world.deviceFlow.completion = new ConnectionProblemError('github-unauthorized', 'Acesso negado');
    const status = await connections.github.completeDeviceFlow.execute(DEVICE_CODE);
    expect(status).toMatchObject({ state: 'error', problem: 'github-unauthorized' });
    expect(world.secrets.values.size).toBe(0);
    expect(world.prefs.current.github.method).toBeNull();
  });

  it('a valid PAT is stored in the keychain', async () => {
    const status = await connections.github.connectWithPat.execute('  ghp_abc  ');
    expect(status).toMatchObject({ state: 'connected' });
    expect(world.secrets.values.get(SECRET_KEYS.githubToken)).toBe('ghp_abc');
    expect(world.prefs.current.github.method).toBe('pat');
  });

  it('an invalid or empty PAT is not stored', async () => {
    world.githubAccounts.outcome = new ConnectionProblemError('github-unauthorized');
    expect(await connections.github.connectWithPat.execute('ghp_ruim')).toMatchObject({ problem: 'github-unauthorized' });
    expect(await connections.github.connectWithPat.execute('   ')).toMatchObject({ problem: 'github-unauthorized' });
    expect(world.secrets.values.size).toBe(0);
  });

  it('401 -> "Sign in to GitHub again": gh CLI opens the terminal', async () => {
    await connections.connect.execute('github');
    world.githubAccounts.outcome = new ConnectionProblemError('github-unauthorized');
    const status = await connections.check.execute('github');
    expect(fixLabel('github', status)).toBe('relogin-github');
    await runFix('github', 'relogin-github');
    expect(world.terminal.commands).toEqual([{ program: 'gh', args: ['auth', 'login', '-h', 'github.com', '-w'] }]);
  });

  it('401 -> "Sign in to GitHub again": the stored token is discarded and the login is offered again', async () => {
    await connections.github.connectWithPat.execute('ghp_abc');
    const status = await runFix('github', 'relogin-github');
    expect(status).toMatchObject({ state: 'disconnected' });
    expect(world.secrets.values.size).toBe(0);
    expect(world.prefs.current.github.method).toBeNull();
    expect(world.terminal.commands).toEqual([]);
  });

  it('missing scope -> "Redo permissions" requests the scopes in gh', async () => {
    world.githubAccounts.outcome = { login: 'dev', scopes: ['gist'], orgAccess: 'ok' };
    const status = await connections.connect.execute('github');
    expect(status).toMatchObject({ problem: 'github-missing-scope' });
    expect(fixLabel('github', status)).toBe('regrant-scopes');
    await runFix('github', 'regrant-scopes');
    expect(world.terminal.commands).toEqual([
      { program: 'gh', args: ['auth', 'refresh', '-h', 'github.com', '-s', 'repo,read:org'] },
    ]);
  });

  it('pending SSO -> "Authorize for the org" opens the SSO URL sent by GitHub', async () => {
    const ssoUrl = 'https://github.com/orgs/Mottu-ops/sso?authorization_request=ABC';
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'sso-required', ssoUrl };
    const status = await connections.connect.execute('github');
    expect(status).toMatchObject({ problem: 'github-org-access' });
    expect(fixLabel('github', status)).toBe('authorize-org');
    const after = await runFix('github', 'authorize-org');
    expect(world.urls.opened).toEqual([ssoUrl]);
    expect(after).toMatchObject({ problem: 'github-org-access' });
    expect(after).toMatchObject({ note: 'authorize-org' });
  });

  it('failing to find the SSO URL falls back to the org SSO page', async () => {
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'sso-required' };
    const status = await connections.connect.execute('github');
    expect(status).toMatchObject({ problem: 'github-org-access' });
    world.githubAccounts.inspect = async () => {
      throw new Error('rede fora');
    };
    await runFix('github', 'authorize-org');
    expect(world.urls.opened).toEqual([GITHUB_ORG_SSO_URL]);
  });

  it('pending SSO without a URL in the header falls back to the org SSO page', async () => {
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'sso-required' };
    await connections.connect.execute('github');
    await runFix('github', 'authorize-org');
    expect(world.urls.opened).toEqual([GITHUB_ORG_SSO_URL]);
  });

  it('non-member has its own problem and button and opens the org page', async () => {
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'not-member' };
    const status = await connections.connect.execute('github');
    expect(status).toEqual({ state: 'error', problem: 'github-not-member' });
    expect(fixLabel('github', status)).toBe('open-org-page');
    await runFix('github', 'open-org-page');
    expect(world.urls.opened).toEqual([GITHUB_ORG_URL]);
  });

  it('larger scopes (admin:org) satisfy read:org', async () => {
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'admin:org'], orgAccess: 'ok' };
    expect(await connections.connect.execute('github')).toMatchObject({ state: 'connected' });
  });

  it('token vanished from the keychain -> github-unauthorized', async () => {
    world.prefs.current = { ...world.prefs.current, github: { method: 'pat' } };
    expect(await connections.check.execute('github')).toMatchObject({ problem: 'github-unauthorized' });
  });

  it('Disconnect deletes the token and forgets the method', async () => {
    await connections.github.connectWithPat.execute('ghp_abc');
    expect(await connections.disconnect.execute('github')).toEqual({ state: 'disconnected' });
    expect(world.secrets.values.size).toBe(0);
    expect(world.prefs.current.github.method).toBeNull();
  });
});

describe('Microsoft', () => {
  it('connects with PKCE and stores the account', async () => {
    const status = await connections.connect.execute('microsoft');
    expect(status).toEqual({ state: 'connected', account: 'dev@mottu.com.br' });
    expect(world.prefs.current.microsoft.account).toBe('dev@mottu.com.br');
    expect(await connections.check.execute('microsoft')).toMatchObject({ state: 'connected' });
  });

  it('expired refresh token -> "Sign in to Microsoft again" redoes the PKCE', async () => {
    await connections.connect.execute('microsoft');
    world.microsoft.tokenOutcome = new ConnectionProblemError('microsoft-expired');
    const status = await connections.check.execute('microsoft');
    expect(fixLabel('microsoft', status)).toBe('relogin-microsoft');
    expect(await runFix('microsoft', 'relogin-microsoft')).toMatchObject({ state: 'connected' });
    expect(world.microsoft.signedIn).toBe(2);
  });

  it('a saved account without a refresh token becomes disconnected, with Connect', async () => {
    await connections.connect.execute('microsoft');
    world.microsoft.tokenOutcome = new ConnectionProblemError('microsoft-not-connected');
    const status = await connections.check.execute('microsoft');
    expect(status).toEqual({ state: 'disconnected' });
    expect(actionsFor('microsoft', status)).toEqual([{ kind: 'connect', label: 'connect' }]);
    expect(await runFix('microsoft', 'connect-microsoft')).toMatchObject({ state: 'connected' });
  });

  it('a login failure becomes an error state, not an exception', async () => {
    world.microsoft.signInOutcome = new ConnectionProblemError('microsoft-expired', 'Login cancelado');
    expect(await connections.connect.execute('microsoft')).toMatchObject({
      state: 'error',
      problem: 'microsoft-expired',
      message: 'Login cancelado',
    });
  });

  it('Disconnect ends the session and forgets the account', async () => {
    await connections.connect.execute('microsoft');
    expect(await connections.disconnect.execute('microsoft')).toEqual({ state: 'disconnected' });
    expect(world.microsoft.signedOut).toBe(1);
    expect(world.prefs.current.microsoft.account).toBeNull();
  });
});

describe('Notifications', () => {
  it('blocked -> "Open system settings" opens the settings', async () => {
    world.notifications.state = 'denied';
    const status = await connections.check.execute('notifications');
    expect(status).toMatchObject({ problem: 'notifications-blocked' });
    expect(fixLabel('notifications', status)).toBe('open-system-settings');
    await runFix('notifications', 'open-system-settings');
    expect(world.systemSettings.notificationsOpened).toBe(1);
  });

  it('an unverifiable state never shows Connected: "Cannot verify" with a button to the settings', async () => {
    world.notifications.state = 'unknown';
    const status = await connections.check.execute('notifications');
    expect(status).toMatchObject({ state: 'error', problem: 'notifications-unverifiable' });
    expect(fixLabel('notifications', status)).toBe('open-system-settings');
    const after = await runFix('notifications', 'open-system-settings');
    expect(world.systemSettings.notificationsOpened).toBe(1);
    expect(after).toMatchObject({ problem: 'notifications-unverifiable' });
  });

  it('not requested yet (prompt) leads to the system settings, without asking through the plugin', async () => {
    world.notifications.state = 'prompt';
    const status = await connections.check.execute('notifications');
    expect(status).toMatchObject({ state: 'error', problem: 'notifications-blocked' });
    expect(fixLabel('notifications', status)).toBe('open-system-settings');
    const after = await runFix('notifications', 'open-system-settings');
    expect(world.systemSettings.notificationsOpened).toBe(1);
    expect(after).toMatchObject({ state: 'error', problem: 'notifications-blocked' });
  });

  it('cannot be disconnected', async () => {
    await expect(connections.disconnect.execute('notifications')).rejects.toThrow('cannot be disconnected');
  });
});

describe('unexpected errors and monitor', () => {
  it('a network error becomes "unexpected" with "Try again"', async () => {
    world.githubAccounts.outcome = new Error('rede fora');
    await connections.connect.execute('github').catch(() => undefined);
    world.prefs.current = { ...world.prefs.current, github: { method: 'gh-cli' } };
    const status = await connections.check.execute('github');
    expect(status).toEqual({ state: 'error', problem: 'unexpected', message: 'rede fora' });
    expect(fixLabel('github', status)).toBe('retry');
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'ok' };
    expect(await runFix('github', 'retry')).toMatchObject({ state: 'connected' });
  });

  it('a fix that does not apply to the connection becomes a typed error', async () => {
    expect(await runFix('claude', 'authorize-org')).toMatchObject({ state: 'error', problem: 'unexpected' });
  });

  it('a late subscriber receives the previously reported problem and sees the fix button', () => {
    connections.report.execute('claude', 'claude-expired');
    const seen: Array<[ConnectionId, ConnectionStatus]> = [];
    connections.monitor.subscribe((id, status) => seen.push([id, status]));
    expect(seen).toHaveLength(1);
    const [id, status] = seen[0] ?? ['claude', { state: 'unknown' } as ConnectionStatus];
    expect(id).toBe('claude');
    expect(status).toMatchObject({ state: 'error', problem: 'claude-expired' });
    expect(actionsFor(id, status).some((action) => action.kind === 'fix')).toBe(true);
  });

  it('the monitor goes through "checking" and ends in the final state', async () => {
    const seen: string[] = [];
    connections.monitor.subscribe((id, status) => seen.push(`${id}:${status.state}`));
    await connections.check.execute('claude');
    expect(seen).toEqual(['claude:checking', 'claude:connected']);
  });

  it('checkMany checks all the requested connections', async () => {
    await connections.checkMany.execute(['claude', 'notifications']);
    expect(connections.monitor.get('claude').state).toBe('connected');
    expect(connections.monitor.get('notifications').state).toBe('connected');
    expect(connections.monitor.get('github').state).toBe('unknown');
  });
});
