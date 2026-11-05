import { describe, expect, it } from 'vitest';
import type { AuthConfig } from '../config/auth-config';
import { createFakeCommands, createFakeFetch, rejectWith } from '../testing/fakes';
import { TauriProcessRunner } from '../platform/tauri-process-runner';
import { GhCliTokenSource } from './gh-cli-token-source';
import { GitHubRestAccountGateway, parseScopes } from './github-account-gateway';
import { GitHubDeviceFlowAuthorizer } from './github-device-flow';

const CONFIG: AuthConfig['github'] = { clientId: 'Iv1.test', scopes: ['repo', 'read:org'] };

describe('GhCliTokenSource', () => {
  it('lê o token de `gh auth token`', async () => {
    const { commands, calls } = createFakeCommands(() => ({ code: 0, stdout: 'gho_abc\n', stderr: '' }));
    expect(await new GhCliTokenSource(new TauriProcessRunner(commands)).token()).toBe('gho_abc');
    expect(calls[0]?.args).toMatchObject({ program: 'gh', args: ['auth', 'token', '-h', 'github.com'] });
  });

  it('sem login ou sem gh devolve null', async () => {
    const loggedOut = createFakeCommands(() => ({ code: 1, stdout: '', stderr: 'not logged in' }));
    expect(await new GhCliTokenSource(new TauriProcessRunner(loggedOut.commands)).token()).toBeNull();
    const missing = createFakeCommands(() => rejectWith('program_not_found', 'gh não encontrado'));
    expect(await new GhCliTokenSource(new TauriProcessRunner(missing.commands)).token()).toBeNull();
  });

  it('outros erros do processo sobem', async () => {
    const { commands } = createFakeCommands(() => rejectWith('timeout', 'demorou'));
    await expect(new GhCliTokenSource(new TauriProcessRunner(commands)).token()).rejects.toMatchObject({
      kind: 'timeout',
    });
  });
});

describe('parseScopes', () => {
  it('separa escopos e distingue header ausente de vazio', () => {
    expect(parseScopes('repo, read:org , gist')).toEqual(['repo', 'read:org', 'gist']);
    expect(parseScopes('')).toEqual([]);
    expect(parseScopes(null)).toBeNull();
  });
});

describe('GitHubRestAccountGateway', () => {
  function gateway(membership: { status: number; headers?: Record<string, string>; json?: unknown }, user = {}) {
    const { fetcher, requests } = createFakeFetch((request) => {
      if (request.url.endsWith('/user')) {
        return { json: { login: 'dev' }, headers: { 'x-oauth-scopes': 'repo, read:org' }, ...user };
      }
      if (request.url.endsWith('/user/memberships/orgs/Mottu-ops')) return membership;
      return undefined;
    });
    return { gateway: new GitHubRestAccountGateway(fetcher), requests };
  }

  it('conta ativa na org com escopos', async () => {
    const { gateway: api, requests } = gateway({ status: 200, json: { state: 'active' } });
    expect(await api.inspect('tok')).toEqual({ login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'ok' });
    expect(requests[0]?.headers['Authorization']).toBe('Bearer tok');
  });

  it('401 em /user é github-unauthorized', async () => {
    const { gateway: api } = gateway({ status: 200 }, { status: 401 });
    await expect(api.inspect('ruim')).rejects.toMatchObject({ problem: 'github-unauthorized' });
  });

  it('403 com X-GitHub-SSO é SSO pendente', async () => {
    const { gateway: api } = gateway({ status: 403, headers: { 'x-github-sso': 'required; url=https://x' } });
    expect((await api.inspect('tok')).orgAccess).toBe('sso-required');
  });

  it('404 e convite pendente contam como não-membro', async () => {
    expect((await gateway({ status: 404 }).gateway.inspect('tok')).orgAccess).toBe('not-member');
    expect((await gateway({ status: 200, json: { state: 'pending' } }).gateway.inspect('tok')).orgAccess).toBe(
      'not-member',
    );
  });

  it('token fine-grained sem header de escopos fica com escopos desconhecidos', async () => {
    const { gateway: api } = gateway({ status: 200, json: { state: 'active' } }, { headers: {} });
    expect((await api.inspect('tok')).scopes).toBeNull();
  });

  it('erro inesperado do GitHub sobe como erro comum', async () => {
    const { gateway: api } = gateway({ status: 500 });
    await expect(api.inspect('tok')).rejects.toThrow('500');
  });
});

describe('GitHubDeviceFlowAuthorizer', () => {
  const noSleep = async () => undefined;

  it('pede o código com client_id e escopos da config', async () => {
    const { fetcher, requests } = createFakeFetch(() => ({
      json: {
        device_code: 'dc',
        user_code: 'WXYZ-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      },
    }));
    const code = await new GitHubDeviceFlowAuthorizer(fetcher, CONFIG, noSleep).start();
    expect(code).toEqual({
      deviceCode: 'dc',
      userCode: 'WXYZ-1234',
      verificationUri: 'https://github.com/login/device',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    });
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ client_id: 'Iv1.test', scope: 'repo read:org' });
  });

  it('com client_id placeholder, falha antes de qualquer chamada', async () => {
    const { fetcher, requests } = createFakeFetch(() => ({ json: {} }));
    const flow = new GitHubDeviceFlowAuthorizer(fetcher, { ...CONFIG, clientId: 'REPLACE_WITH_X' }, noSleep);
    await expect(flow.start()).rejects.toMatchObject({ problem: 'unexpected' });
    expect(requests).toEqual([]);
  });

  it('faz polling até autorizar, respeitando slow_down', async () => {
    const answers = [{ error: 'authorization_pending' }, { error: 'slow_down' }, { access_token: 'gho_final' }];
    const { fetcher } = createFakeFetch(() => ({ json: answers.shift() }));
    const sleeps: number[] = [];
    const flow = new GitHubDeviceFlowAuthorizer(fetcher, CONFIG, async (ms) => void sleeps.push(ms));
    const token = await flow.complete({
      deviceCode: 'dc',
      userCode: 'U',
      verificationUri: 'v',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    });
    expect(token).toBe('gho_final');
    expect(sleeps).toEqual([5000, 5000, 10000]);
  });

  it('access_denied e expired_token viram github-unauthorized', async () => {
    const code = { deviceCode: 'dc', userCode: 'U', verificationUri: 'v', intervalSeconds: 5, expiresInSeconds: 900 };
    for (const error of ['access_denied', 'expired_token']) {
      const { fetcher } = createFakeFetch(() => ({ json: { error } }));
      await expect(new GitHubDeviceFlowAuthorizer(fetcher, CONFIG, noSleep).complete(code)).rejects.toMatchObject({
        problem: 'github-unauthorized',
      });
    }
  });

  it('para quando o tempo do código acaba', async () => {
    const { fetcher } = createFakeFetch(() => ({ json: { error: 'authorization_pending' } }));
    const flow = new GitHubDeviceFlowAuthorizer(fetcher, CONFIG, noSleep);
    await expect(
      flow.complete({ deviceCode: 'dc', userCode: 'U', verificationUri: 'v', intervalSeconds: 5, expiresInSeconds: 12 }),
    ).rejects.toMatchObject({ problem: 'github-unauthorized' });
  });
});
