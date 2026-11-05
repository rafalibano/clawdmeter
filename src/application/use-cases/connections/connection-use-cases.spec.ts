import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_INSTALL_URL,
  ConnectionProblemError,
  GITHUB_ORG_SSO_URL,
  GITHUB_ORG_URL,
  PROBLEM_MESSAGES,
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
  it('conecta com a credencial do Claude Code e mostra o plano', async () => {
    expect(await connections.check.execute('claude')).toEqual({ state: 'connected', detail: 'Plano max' });
  });

  it('nunca escreve nem apaga a credencial (só lê)', async () => {
    await connections.check.execute('claude');
    await connections.disconnect.execute('claude');
    expect(world.secrets.values.size).toBe(0);
    expect(world.claude.reads).toBe(1);
  });

  it('keychain negado -> "Refazer permissão" -> releitura conecta', async () => {
    world.claude.outcome = new ConnectionProblemError('keychain-denied');
    const status = await connections.check.execute('claude');
    expect(status).toMatchObject({ state: 'error', problem: 'keychain-denied' });
    expect(fixLabel('claude', status)).toBe('Refazer permissão');
    world.claude.outcome = { accessToken: 't', expiresAt: null, subscriptionType: null };
    expect(await runFix('claude', 'retry-permission')).toEqual({ state: 'connected' });
  });

  it('token vencido -> "Refazer login do Claude" abre o terminal com /login', async () => {
    world.claude.outcome = { accessToken: 't', expiresAt: 5_000, subscriptionType: 'pro' };
    const status = await connections.check.execute('claude');
    expect(status).toMatchObject({ problem: 'claude-expired' });
    expect(fixLabel('claude', status)).toBe('Refazer login do Claude');
    const after = await runFix('claude', 'relogin-claude');
    expect(world.terminal.commands).toEqual([{ program: 'claude', args: ['/login'] }]);
    expect(after).toMatchObject({ state: 'error', problem: 'claude-expired' });
  });

  it('Claude Code ausente -> "Instalar Claude Code" abre a página de instalação', async () => {
    world.claude.outcome = new ConnectionProblemError('claude-code-missing');
    const status = await connections.check.execute('claude');
    expect(fixLabel('claude', status)).toBe('Instalar Claude Code');
    await runFix('claude', 'install-claude-code');
    expect(world.urls.opened).toEqual([CLAUDE_CODE_INSTALL_URL]);
  });

  it('401 reportado por um gateway marca a conexão como vencida', () => {
    connections.report.execute('claude', 'claude-expired');
    expect(connections.monitor.get('claude')).toMatchObject({ problem: 'claude-expired' });
  });

  it('Desconectar para de usar a credencial e Conectar volta a lê-la', async () => {
    await connections.connect.execute('claude');
    expect(await connections.disconnect.execute('claude')).toEqual({ state: 'disconnected' });
    expect(await connections.check.execute('claude')).toEqual({ state: 'disconnected' });
    expect(world.claude.reads).toBe(1);
    expect(await connections.connect.execute('claude')).toMatchObject({ state: 'connected' });
  });
});

describe('GitHub', () => {
  it('sem conexão feita, começa desconectado', async () => {
    expect(await connections.check.execute('github')).toEqual({ state: 'disconnected' });
  });

  it('conecta pelo gh CLI sem guardar o token', async () => {
    const status = await connections.connect.execute('github');
    expect(status).toEqual({ state: 'connected', account: 'dev' });
    expect(world.prefs.current.github.method).toBe('gh-cli');
    expect(world.secrets.values.size).toBe(0);
    expect(world.githubAccounts.inspected).toEqual(['gh-token']);
  });

  it('sem login no gh, oferece device flow ou PAT', async () => {
    world.githubCli.outcome = null;
    const status = await connections.connect.execute('github');
    expect(status).toMatchObject({ state: 'disconnected' });
    expect(status.state === 'disconnected' && status.hint).toContain('código do GitHub');
    expect(world.prefs.current.github.method).toBeNull();
  });

  it('Device Flow abre a página de verificação, guarda o token no cofre e conecta', async () => {
    const code = await connections.github.startDeviceFlow.execute();
    expect(code).toEqual(DEVICE_CODE);
    const status = await connections.github.completeDeviceFlow.execute(DEVICE_CODE);
    expect(world.urls.opened).toEqual([DEVICE_CODE.verificationUri]);
    expect(status).toEqual({ state: 'connected', account: 'dev' });
    expect(world.secrets.values.get(SECRET_KEYS.githubToken)).toBe('device-token');
    expect(world.prefs.current.github.method).toBe('device-flow');
    expect(await connections.check.execute('github')).toMatchObject({ state: 'connected' });
  });

  it('start com falha (client_id placeholder) vira estado de erro com botão, não engole o erro', async () => {
    world.deviceFlow.startOutcome = new ConnectionProblemError('unexpected', 'client_id do GitHub OAuth App não configurado');
    expect(await connections.github.startDeviceFlow.execute()).toBeNull();
    const status = connections.monitor.get('github');
    expect(status).toEqual({
      state: 'error',
      problem: 'unexpected',
      message: 'client_id do GitHub OAuth App não configurado',
    });
    expect(fixLabel('github', status)).toBe('Tentar de novo');
  });

  it('falha ao abrir a página de verificação também vira estado de erro', async () => {
    world.urls.open = async () => {
      throw new Error('sem navegador');
    };
    const status = await connections.github.completeDeviceFlow.execute(DEVICE_CODE);
    expect(status).toEqual({ state: 'error', problem: 'unexpected', message: 'sem navegador' });
    expect(world.secrets.values.size).toBe(0);
  });

  it('cancelar o Device Flow volta a desconectado sem gravar nada', async () => {
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

  it('Device Flow negado não grava nada', async () => {
    world.deviceFlow.completion = new ConnectionProblemError('github-unauthorized', 'Acesso negado');
    const status = await connections.github.completeDeviceFlow.execute(DEVICE_CODE);
    expect(status).toMatchObject({ state: 'error', problem: 'github-unauthorized' });
    expect(world.secrets.values.size).toBe(0);
    expect(world.prefs.current.github.method).toBeNull();
  });

  it('PAT válido é guardado no cofre', async () => {
    const status = await connections.github.connectWithPat.execute('  ghp_abc  ');
    expect(status).toMatchObject({ state: 'connected' });
    expect(world.secrets.values.get(SECRET_KEYS.githubToken)).toBe('ghp_abc');
    expect(world.prefs.current.github.method).toBe('pat');
  });

  it('PAT inválido ou vazio não é guardado', async () => {
    world.githubAccounts.outcome = new ConnectionProblemError('github-unauthorized');
    expect(await connections.github.connectWithPat.execute('ghp_ruim')).toMatchObject({ problem: 'github-unauthorized' });
    expect(await connections.github.connectWithPat.execute('   ')).toMatchObject({ problem: 'github-unauthorized' });
    expect(world.secrets.values.size).toBe(0);
  });

  it('401 -> "Refazer login do GitHub": gh CLI abre o terminal', async () => {
    await connections.connect.execute('github');
    world.githubAccounts.outcome = new ConnectionProblemError('github-unauthorized');
    const status = await connections.check.execute('github');
    expect(fixLabel('github', status)).toBe('Refazer login do GitHub');
    await runFix('github', 'relogin-github');
    expect(world.terminal.commands).toEqual([{ program: 'gh', args: ['auth', 'login', '-h', 'github.com', '-w'] }]);
  });

  it('401 -> "Refazer login do GitHub": token guardado é descartado e volta a oferecer o login', async () => {
    await connections.github.connectWithPat.execute('ghp_abc');
    const status = await runFix('github', 'relogin-github');
    expect(status).toMatchObject({ state: 'disconnected' });
    expect(world.secrets.values.size).toBe(0);
    expect(world.prefs.current.github.method).toBeNull();
    expect(world.terminal.commands).toEqual([]);
  });

  it('escopo faltando -> "Refazer permissões" pede os escopos no gh', async () => {
    world.githubAccounts.outcome = { login: 'dev', scopes: ['gist'], orgAccess: 'ok' };
    const status = await connections.connect.execute('github');
    expect(status).toMatchObject({ problem: 'github-missing-scope' });
    expect(fixLabel('github', status)).toBe('Refazer permissões');
    await runFix('github', 'regrant-scopes');
    expect(world.terminal.commands).toEqual([
      { program: 'gh', args: ['auth', 'refresh', '-h', 'github.com', '-s', 'repo,read:org'] },
    ]);
  });

  it('SSO pendente -> "Autorizar na org" abre a URL de SSO enviada pelo GitHub', async () => {
    const ssoUrl = 'https://github.com/orgs/Mottu-ops/sso?authorization_request=ABC';
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'sso-required', ssoUrl };
    const status = await connections.connect.execute('github');
    expect(status).toMatchObject({ problem: 'github-org-access' });
    expect(fixLabel('github', status)).toBe('Autorizar na org');
    const after = await runFix('github', 'authorize-org');
    expect(world.urls.opened).toEqual([ssoUrl]);
    expect(after).toMatchObject({ problem: 'github-org-access' });
    expect(after.state === 'error' && after.message).toContain('Verificar de novo');
  });

  it('SSO pendente sem URL no header cai na página de SSO da org', async () => {
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'sso-required' };
    await connections.connect.execute('github');
    await runFix('github', 'authorize-org');
    expect(world.urls.opened).toEqual([GITHUB_ORG_SSO_URL]);
  });

  it('não-membro tem problema e botão próprios e abre a página da org', async () => {
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'not-member' };
    const status = await connections.connect.execute('github');
    expect(status).toEqual({ state: 'error', problem: 'github-not-member' });
    expect(PROBLEM_MESSAGES['github-not-member']).toBe('Você não é membro da org Mottu-ops.');
    expect(fixLabel('github', status)).toBe('Abrir página da org');
    await runFix('github', 'open-org-page');
    expect(world.urls.opened).toEqual([GITHUB_ORG_URL]);
  });

  it('escopos maiores (admin:org) satisfazem read:org', async () => {
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'admin:org'], orgAccess: 'ok' };
    expect(await connections.connect.execute('github')).toMatchObject({ state: 'connected' });
  });

  it('token sumiu do cofre -> github-unauthorized', async () => {
    world.prefs.current = { ...world.prefs.current, github: { method: 'pat' } };
    expect(await connections.check.execute('github')).toMatchObject({ problem: 'github-unauthorized' });
  });

  it('Desconectar apaga o token e esquece o método', async () => {
    await connections.github.connectWithPat.execute('ghp_abc');
    expect(await connections.disconnect.execute('github')).toEqual({ state: 'disconnected' });
    expect(world.secrets.values.size).toBe(0);
    expect(world.prefs.current.github.method).toBeNull();
  });
});

describe('Microsoft', () => {
  it('conecta com PKCE e guarda a conta', async () => {
    const status = await connections.connect.execute('microsoft');
    expect(status).toEqual({ state: 'connected', account: 'dev@mottu.com.br' });
    expect(world.prefs.current.microsoft.account).toBe('dev@mottu.com.br');
    expect(await connections.check.execute('microsoft')).toMatchObject({ state: 'connected' });
  });

  it('refresh token expirado -> "Refazer login da Microsoft" refaz o PKCE', async () => {
    await connections.connect.execute('microsoft');
    world.microsoft.tokenOutcome = new ConnectionProblemError('microsoft-expired');
    const status = await connections.check.execute('microsoft');
    expect(fixLabel('microsoft', status)).toBe('Refazer login da Microsoft');
    expect(await runFix('microsoft', 'relogin-microsoft')).toMatchObject({ state: 'connected' });
    expect(world.microsoft.signedIn).toBe(2);
  });

  it('conta salva mas sem refresh token vira desconectada, com Conectar', async () => {
    await connections.connect.execute('microsoft');
    world.microsoft.tokenOutcome = new ConnectionProblemError('microsoft-not-connected');
    const status = await connections.check.execute('microsoft');
    expect(status).toEqual({ state: 'disconnected' });
    expect(actionsFor('microsoft', status)).toEqual([{ kind: 'connect', label: 'Conectar' }]);
    expect(await runFix('microsoft', 'connect-microsoft')).toMatchObject({ state: 'connected' });
  });

  it('falha de login vira estado de erro, não exceção', async () => {
    world.microsoft.signInOutcome = new ConnectionProblemError('microsoft-expired', 'Login cancelado');
    expect(await connections.connect.execute('microsoft')).toMatchObject({
      state: 'error',
      problem: 'microsoft-expired',
      message: 'Login cancelado',
    });
  });

  it('Desconectar encerra a sessão e esquece a conta', async () => {
    await connections.connect.execute('microsoft');
    expect(await connections.disconnect.execute('microsoft')).toEqual({ state: 'disconnected' });
    expect(world.microsoft.signedOut).toBe(1);
    expect(world.prefs.current.microsoft.account).toBeNull();
  });
});

describe('Notificações', () => {
  it('bloqueadas -> "Abrir ajustes do sistema" abre os ajustes', async () => {
    world.notifications.state = 'denied';
    const status = await connections.check.execute('notifications');
    expect(status).toMatchObject({ problem: 'notifications-blocked' });
    expect(fixLabel('notifications', status)).toBe('Abrir ajustes do sistema');
    await runFix('notifications', 'open-system-settings');
    expect(world.systemSettings.notificationsOpened).toBe(1);
  });

  it('estado não verificável nunca mostra Conectado: "Não verificável" com botão para os ajustes', async () => {
    world.notifications.state = 'unknown';
    const status = await connections.check.execute('notifications');
    expect(status).toMatchObject({ state: 'error', problem: 'notifications-unverifiable' });
    expect(fixLabel('notifications', status)).toBe('Abrir ajustes do sistema');
    const after = await runFix('notifications', 'open-system-settings');
    expect(world.systemSettings.notificationsOpened).toBe(1);
    expect(after).toMatchObject({ problem: 'notifications-unverifiable' });
  });

  it('ainda não pedidas (prompt) leva aos ajustes do sistema, sem pedir pelo plugin', async () => {
    world.notifications.state = 'prompt';
    const status = await connections.check.execute('notifications');
    expect(status).toMatchObject({ state: 'error', problem: 'notifications-blocked' });
    expect(fixLabel('notifications', status)).toBe('Abrir ajustes do sistema');
    const after = await runFix('notifications', 'open-system-settings');
    expect(world.systemSettings.notificationsOpened).toBe(1);
    expect(after).toMatchObject({ state: 'error', problem: 'notifications-blocked' });
  });

  it('não pode ser desconectada', async () => {
    await expect(connections.disconnect.execute('notifications')).rejects.toThrow('não pode ser desconectada');
  });
});

describe('erros inesperados e monitor', () => {
  it('erro de rede vira "unexpected" com "Tentar de novo"', async () => {
    world.githubAccounts.outcome = new Error('rede fora');
    await connections.connect.execute('github').catch(() => undefined);
    world.prefs.current = { ...world.prefs.current, github: { method: 'gh-cli' } };
    const status = await connections.check.execute('github');
    expect(status).toEqual({ state: 'error', problem: 'unexpected', message: 'rede fora' });
    expect(fixLabel('github', status)).toBe('Tentar de novo');
    world.githubAccounts.outcome = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'ok' };
    expect(await runFix('github', 'retry')).toMatchObject({ state: 'connected' });
  });

  it('conserto que não se aplica à conexão vira erro tipado', async () => {
    expect(await runFix('claude', 'authorize-org')).toMatchObject({ state: 'error', problem: 'unexpected' });
  });

  it('assinante tardio recebe o problema reportado antes e vê o botão de conserto', () => {
    connections.report.execute('claude', 'claude-expired');
    const seen: Array<[ConnectionId, ConnectionStatus]> = [];
    connections.monitor.subscribe((id, status) => seen.push([id, status]));
    expect(seen).toHaveLength(1);
    const [id, status] = seen[0] ?? ['claude', { state: 'unknown' } as ConnectionStatus];
    expect(id).toBe('claude');
    expect(status).toMatchObject({ state: 'error', problem: 'claude-expired' });
    expect(actionsFor(id, status).some((action) => action.kind === 'fix')).toBe(true);
  });

  it('o monitor passa por "checking" e termina no estado final', async () => {
    const seen: string[] = [];
    connections.monitor.subscribe((id, status) => seen.push(`${id}:${status.state}`));
    await connections.check.execute('claude');
    expect(seen).toEqual(['claude:checking', 'claude:connected']);
  });

  it('checkMany verifica todas as conexões pedidas', async () => {
    await connections.checkMany.execute(['claude', 'notifications']);
    expect(connections.monitor.get('claude').state).toBe('connected');
    expect(connections.monitor.get('notifications').state).toBe('connected');
    expect(connections.monitor.get('github').state).toBe('unknown');
  });
});
