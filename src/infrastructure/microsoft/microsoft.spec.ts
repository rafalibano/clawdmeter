import { describe, expect, it } from 'vitest';
import { SECRET_KEYS } from '../../application/ports';
import { FakeSecretStore, FakeUrlOpener } from '../../application/testing/fake-connection-adapters';
import type { AuthConfig } from '../config/auth-config';
import { PlatformCommandError } from '../platform/tauri-commands';
import type { OAuthLoopback } from '../platform/tauri-oauth-loopback';
import { createFakeFetch } from '../testing/fakes';
import { base64UrlEncode, challengeS256, createPkcePair, decodeJwtClaims } from './pkce';
import { PkceMicrosoftAuthorizer } from './pkce-microsoft-authorizer';

const CONFIG: AuthConfig['microsoft'] = {
  clientId: 'entra-client',
  tenant: 'organizations',
  scopes: ['openid', 'profile', 'offline_access', 'Calendars.Read'],
  loginTimeoutMs: 1000,
};

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
  return `${encode({ alg: 'none' })}.${encode(claims)}.sig`;
}

describe('PKCE', () => {
  it('generates the S256 challenge of the RFC 7636 test vector', async () => {
    expect(await challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('verifier and challenge are unpadded base64url and the pair is consistent', async () => {
    const pair = await createPkcePair();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(pair.challenge).toBe(await challengeS256(pair.verifier));
  });

  it('decodes the claims of a JWT and rejects garbage', () => {
    expect(decodeJwtClaims(jwt({ preferred_username: 'a@b.c' }))).toEqual({ preferred_username: 'a@b.c' });
    expect(decodeJwtClaims('lixo')).toBeNull();
  });
});

class FakeLoopback implements OAuthLoopback {
  state = '';
  cancelled: string[] = [];
  waitError: Error | null = null;

  async listen() {
    return { id: 'l1', port: 54321 };
  }

  async waitForCode(_id: string, expectedState: string): Promise<string> {
    this.state = expectedState;
    if (this.waitError) throw this.waitError;
    return 'auth-code';
  }

  async cancel(id: string): Promise<void> {
    this.cancelled.push(id);
  }
}

function setup(responder: Parameters<typeof createFakeFetch>[0], config = CONFIG) {
  const { fetcher, requests } = createFakeFetch(responder);
  const loopback = new FakeLoopback();
  const urls = new FakeUrlOpener();
  const secrets = new FakeSecretStore();
  let now = 1_000_000;
  const authorizer = new PkceMicrosoftAuthorizer({ fetcher, loopback, urls, secrets, now: () => now, config });
  return { authorizer, requests, loopback, urls, secrets, advance: (ms: number) => (now += ms) };
}

describe('PkceMicrosoftAuthorizer.signIn', () => {
  it('opens the browser with PKCE S256, exchanges the code and stores only the refresh token in the vault', async () => {
    const { authorizer, requests, loopback, urls, secrets } = setup(() => ({
      json: {
        access_token: 'graph-at',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        id_token: jwt({ preferred_username: 'dev@mottu.com.br' }),
      },
    }));
    const session = await authorizer.signIn();
    expect(session).toEqual({ account: 'dev@mottu.com.br' });

    const authorize = new URL(urls.opened[0] ?? '');
    expect(authorize.origin + authorize.pathname).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize');
    expect(authorize.searchParams.get('client_id')).toBe('entra-client');
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321/callback');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('state')).toBe(loopback.state);
    expect(authorize.searchParams.get('scope')).toContain('Calendars.Read');

    const form = new URLSearchParams(requests[0]?.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('auth-code');
    expect(await challengeS256(form.get('code_verifier') ?? '')).toBe(authorize.searchParams.get('code_challenge'));

    expect(secrets.values.get(SECRET_KEYS.microsoftRefreshToken)).toBe('refresh-1');
    expect([...secrets.values.values()]).not.toContain('graph-at');
    expect(loopback.cancelled).toEqual(['l1']);
  });

  it('with a placeholder client_id, fails without opening anything', async () => {
    const { authorizer, urls } = setup(() => ({ json: {} }), { ...CONFIG, clientId: 'REPLACE_WITH_X' });
    await expect(authorizer.signIn()).rejects.toMatchObject({ problem: 'unexpected' });
    expect(urls.opened).toEqual([]);
  });

  it('loopback timeout or invalid state become microsoft-expired', async () => {
    const { authorizer, loopback } = setup(() => ({ json: {} }));
    loopback.waitError = new PlatformCommandError('timeout', 'tempo esgotado aguardando o login');
    await expect(authorizer.signIn()).rejects.toMatchObject({
      problem: 'microsoft-expired',
      message: 'tempo esgotado aguardando o login',
    });
    expect(loopback.cancelled).toEqual(['l1']);
  });

  it('a token endpoint error becomes a plain error', async () => {
    const { authorizer } = setup(() => ({ status: 400, json: { error: 'invalid_request', error_description: 'ruim\r\nTrace' } }));
    await expect(authorizer.signIn()).rejects.toThrow('ruim');
  });
});

describe('PkceMicrosoftAuthorizer.accessToken', () => {
  it('without a refresh token in the vault it never connected: asks to Connect, not to sign in again', async () => {
    const { authorizer } = setup(() => ({ json: {} }));
    await expect(authorizer.accessToken()).rejects.toMatchObject({ problem: 'microsoft-not-connected' });
  });

  it('renews with the refresh token, rotates it and uses the cache until close to expiry', async () => {
    const { authorizer, requests, secrets, advance } = setup(() => ({
      json: { access_token: 'at', refresh_token: 'refresh-2', expires_in: 3600 },
    }));
    secrets.values.set(SECRET_KEYS.microsoftRefreshToken, 'refresh-1');
    expect(await authorizer.accessToken()).toBe('at');
    expect(await authorizer.accessToken()).toBe('at');
    expect(requests).toHaveLength(1);
    expect(new URLSearchParams(requests[0]?.body).get('refresh_token')).toBe('refresh-1');
    expect(secrets.values.get(SECRET_KEYS.microsoftRefreshToken)).toBe('refresh-2');
    advance(3_600_000);
    await authorizer.accessToken();
    expect(requests).toHaveLength(2);
  });

  it('invalid_grant becomes microsoft-expired', async () => {
    const { authorizer, secrets } = setup(() => ({ status: 400, json: { error: 'invalid_grant', error_description: 'expirou' } }));
    secrets.values.set(SECRET_KEYS.microsoftRefreshToken, 'velho');
    await expect(authorizer.accessToken()).rejects.toMatchObject({ problem: 'microsoft-expired' });
  });

  it('signOut deletes the refresh token and the cache', async () => {
    const { authorizer, secrets, requests } = setup(() => ({ json: { access_token: 'at', expires_in: 3600 } }));
    secrets.values.set(SECRET_KEYS.microsoftRefreshToken, 'r');
    await authorizer.accessToken();
    await authorizer.signOut();
    expect(secrets.values.size).toBe(0);
    await expect(authorizer.accessToken()).rejects.toMatchObject({ problem: 'microsoft-not-connected' });
    expect(requests).toHaveLength(1);
  });
});
