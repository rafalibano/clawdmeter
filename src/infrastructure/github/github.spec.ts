import { describe, expect, it } from 'vitest';
import type { AuthConfig } from '../config/auth-config';
import { createFakeCommands, createFakeFetch, rejectWith } from '../testing/fakes';
import { TauriProcessRunner } from '../platform/tauri-process-runner';
import { GhCliTokenSource } from './gh-cli-token-source';
import { GitHubRestAccountGateway, parseScopes } from './github-account-gateway';
import { GitHubDeviceFlowAuthorizer } from './github-device-flow';

const CONFIG: AuthConfig['github'] = { clientId: 'Iv1.test', scopes: ['repo', 'read:org'] };

describe('GhCliTokenSource', () => {
  it('reads the token from `gh auth token`', async () => {
    const { commands, calls } = createFakeCommands(() => ({ code: 0, stdout: 'gho_abc\n', stderr: '' }));
    expect(await new GhCliTokenSource(new TauriProcessRunner(commands)).token()).toEqual({ token: 'gho_abc' });
    expect(calls[0]?.args).toMatchObject({ program: 'gh', args: ['auth', 'token', '-h', 'github.com'] });
  });

  it('gh installed with an authentication error returns not-logged-in', async () => {
    const loggedOut = createFakeCommands(() => ({ code: 1, stdout: '', stderr: 'not logged in' }));
    expect(await new GhCliTokenSource(new TauriProcessRunner(loggedOut.commands)).token()).toEqual({
      missing: 'not-logged-in',
    });
  });

  it('empty output with exit code 0 is also not-logged-in', async () => {
    const empty = createFakeCommands(() => ({ code: 0, stdout: '\n', stderr: '' }));
    expect(await new GhCliTokenSource(new TauriProcessRunner(empty.commands)).token()).toEqual({
      missing: 'not-logged-in',
    });
  });

  it('program_not_found returns not-installed', async () => {
    const missing = createFakeCommands(() => rejectWith('program_not_found', 'gh not found'));
    expect(await new GhCliTokenSource(new TauriProcessRunner(missing.commands)).token()).toEqual({
      missing: 'not-installed',
    });
  });

  it('other process errors surface', async () => {
    const { commands } = createFakeCommands(() => rejectWith('timeout', 'demorou'));
    await expect(new GhCliTokenSource(new TauriProcessRunner(commands)).token()).rejects.toMatchObject({
      kind: 'timeout',
    });
  });
});

describe('parseScopes', () => {
  it('splits scopes and tells a missing header from an empty one', () => {
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

  it('active account in the org with scopes', async () => {
    const { gateway: api, requests } = gateway({ status: 200, json: { state: 'active' } });
    expect(await api.inspect('tok')).toEqual({ login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'ok' });
    expect(requests[0]?.headers['Authorization']).toBe('Bearer tok');
  });

  it('401 on /user is github-unauthorized', async () => {
    const { gateway: api } = gateway({ status: 200 }, { status: 401 });
    await expect(api.inspect('ruim')).rejects.toMatchObject({ problem: 'github-unauthorized' });
  });

  it('403 with X-GitHub-SSO is pending SSO', async () => {
    const { gateway: api } = gateway({ status: 403, headers: { 'x-github-sso': 'required; url=https://x' } });
    expect((await api.inspect('tok')).orgAccess).toBe('sso-required');
  });

  it('keeps the SSO URL sent by GitHub when it is https on github.com', async () => {
    const url = 'https://github.com/orgs/Mottu-ops/sso?authorization_request=ABC';
    const { gateway: api } = gateway({ status: 403, headers: { 'x-github-sso': `required; url=${url}` } });
    expect(await api.inspect('tok')).toMatchObject({ orgAccess: 'sso-required', ssoUrl: url });
  });

  it('discards an SSO URL from another host or without https', async () => {
    for (const header of ['required; url=https://evil.example/sso', 'required; url=http://github.com/sso']) {
      const { gateway: api } = gateway({ status: 403, headers: { 'x-github-sso': header } });
      const account = await api.inspect('tok');
      expect(account.orgAccess).toBe('sso-required');
      expect(account.ssoUrl).toBeUndefined();
    }
  });

  it('404 and a pending invitation count as not a member', async () => {
    expect((await gateway({ status: 404 }).gateway.inspect('tok')).orgAccess).toBe('not-member');
    expect((await gateway({ status: 200, json: { state: 'pending' } }).gateway.inspect('tok')).orgAccess).toBe(
      'not-member',
    );
  });

  it('a fine-grained token without a scopes header has unknown scopes', async () => {
    const { gateway: api } = gateway({ status: 200, json: { state: 'active' } }, { headers: {} });
    expect((await api.inspect('tok')).scopes).toBeNull();
  });

  it('an unexpected GitHub error surfaces as a plain error', async () => {
    const { gateway: api } = gateway({ status: 500 });
    await expect(api.inspect('tok')).rejects.toThrow('500');
  });
});

describe('GitHubDeviceFlowAuthorizer', () => {
  const noSleep = async () => undefined;

  it('requests the code with the client_id and scopes from the config', async () => {
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

  it('with a placeholder client_id, fails before any call', async () => {
    const { fetcher, requests } = createFakeFetch(() => ({ json: {} }));
    const flow = new GitHubDeviceFlowAuthorizer(fetcher, { ...CONFIG, clientId: 'REPLACE_WITH_X' }, noSleep);
    await expect(flow.start()).rejects.toMatchObject({ problem: 'unexpected' });
    expect(requests).toEqual([]);
  });

  it('polls until authorized, honoring slow_down', async () => {
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

  it('access_denied and expired_token become github-unauthorized', async () => {
    const code = { deviceCode: 'dc', userCode: 'U', verificationUri: 'v', intervalSeconds: 5, expiresInSeconds: 900 };
    for (const error of ['access_denied', 'expired_token']) {
      const { fetcher } = createFakeFetch(() => ({ json: { error } }));
      await expect(new GitHubDeviceFlowAuthorizer(fetcher, CONFIG, noSleep).complete(code)).rejects.toMatchObject({
        problem: 'github-unauthorized',
      });
    }
  });

  it('device_flow_disabled and incorrect_client_credentials become unexpected, not github-unauthorized', async () => {
    const code = { deviceCode: 'dc', userCode: 'U', verificationUri: 'v', intervalSeconds: 5, expiresInSeconds: 900 };
    for (const error of ['device_flow_disabled', 'incorrect_client_credentials']) {
      const { fetcher } = createFakeFetch(() => ({ json: { error } }));
      await expect(new GitHubDeviceFlowAuthorizer(fetcher, CONFIG, noSleep).complete(code)).rejects.toMatchObject({
        problem: 'unexpected',
      });
    }
  });

  it('cancelling stops the polling without requesting the token', async () => {
    const { fetcher, requests } = createFakeFetch(() => ({ json: { error: 'authorization_pending' } }));
    const controller = new AbortController();
    const flow = new GitHubDeviceFlowAuthorizer(fetcher, CONFIG, async () => controller.abort());
    const code = { deviceCode: 'dc', userCode: 'U', verificationUri: 'v', intervalSeconds: 5, expiresInSeconds: 900 };
    await expect(flow.complete(code, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toEqual([]);
  });

  it('passes the AbortSignal to the polling fetch and ignores a token that arrives after cancellation', async () => {
    const controller = new AbortController();
    const { fetcher, requests } = createFakeFetch(() => {
      controller.abort();
      return { json: { access_token: 'tarde-demais' } };
    });
    const flow = new GitHubDeviceFlowAuthorizer(fetcher, CONFIG, noSleep);
    const code = { deviceCode: 'dc', userCode: 'U', verificationUri: 'v', intervalSeconds: 5, expiresInSeconds: 900 };
    await expect(flow.complete(code, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests[0]?.signal).toBe(controller.signal);
  });

  it('the real sleep wakes up with AbortError when the signal is aborted', async () => {
    const { fetcher } = createFakeFetch(() => ({ json: {} }));
    const controller = new AbortController();
    const flow = new GitHubDeviceFlowAuthorizer(fetcher, CONFIG);
    const code = { deviceCode: 'dc', userCode: 'U', verificationUri: 'v', intervalSeconds: 60, expiresInSeconds: 900 };
    const pending = flow.complete(code, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops when the code time runs out', async () => {
    const { fetcher } = createFakeFetch(() => ({ json: { error: 'authorization_pending' } }));
    const flow = new GitHubDeviceFlowAuthorizer(fetcher, CONFIG, noSleep);
    await expect(
      flow.complete({ deviceCode: 'dc', userCode: 'U', verificationUri: 'v', intervalSeconds: 5, expiresInSeconds: 12 }),
    ).rejects.toMatchObject({ problem: 'github-unauthorized' });
  });
});
