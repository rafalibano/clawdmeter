import { SECRET_KEYS, type MicrosoftAuthorizer, type MicrosoftSession, type SecretStore, type UrlOpener } from '../../application/ports';
import { ConnectionProblemError } from '../../domain/connections';
import { AUTH_CONFIG, requireClientId, type AuthConfig } from '../config/auth-config';
import { PlatformCommandError } from '../platform/tauri-commands';
import type { FetchLike } from '../platform/tauri-fetch';
import type { OAuthLoopback } from '../platform/tauri-oauth-loopback';
import { createPkcePair, decodeJwtClaims, randomBase64Url } from './pkce';

const AUTHORITY = 'https://login.microsoftonline.com';
const EXPIRY_MARGIN_MS = 60_000;
const REAUTH_ERRORS = ['invalid_grant', 'interaction_required', 'login_required'];

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface MicrosoftAuthorizerDeps {
  fetcher: FetchLike;
  loopback: OAuthLoopback;
  urls: UrlOpener;
  secrets: SecretStore;
  now: () => number;
  config?: AuthConfig['microsoft'];
}

export class PkceMicrosoftAuthorizer implements MicrosoftAuthorizer {
  private readonly config: AuthConfig['microsoft'];
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(private readonly deps: MicrosoftAuthorizerDeps) {
    this.config = deps.config ?? AUTH_CONFIG.microsoft;
  }

  async signIn(): Promise<MicrosoftSession> {
    const clientId = requireClientId(this.config.clientId, 'Microsoft Entra ID');
    const listener = await this.deps.loopback.listen();
    try {
      const redirectUri = `http://127.0.0.1:${listener.port}/callback`;
      const { verifier, challenge } = await createPkcePair();
      const state = randomBase64Url(24);
      await this.deps.urls.open(this.authorizeUrl(clientId, redirectUri, state, challenge));
      const code = await this.waitForCode(listener.id, state);
      const tokens = await this.requestTokens({
        client_id: clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        scope: this.config.scopes.join(' '),
      });
      await this.storeTokens(tokens);
      const claims = tokens.id_token ? decodeJwtClaims(tokens.id_token) : null;
      const account = claims?.['preferred_username'] ?? claims?.['email'];
      return { account: typeof account === 'string' ? account : 'Conta Microsoft' };
    } finally {
      await this.deps.loopback.cancel(listener.id).catch(() => undefined);
    }
  }

  async accessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.deps.now()) return this.cached.token;
    const refreshToken = await this.deps.secrets.get(SECRET_KEYS.microsoftRefreshToken);
    if (refreshToken === null) throw new ConnectionProblemError('microsoft-expired');
    const tokens = await this.requestTokens({
      client_id: requireClientId(this.config.clientId, 'Microsoft Entra ID'),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: this.config.scopes.join(' '),
    });
    await this.storeTokens(tokens);
    return this.cached?.token ?? '';
  }

  async signOut(): Promise<void> {
    this.cached = null;
    await this.deps.secrets.delete(SECRET_KEYS.microsoftRefreshToken);
  }

  private authorizeUrl(clientId: string, redirectUri: string, state: string, challenge: string): string {
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: this.config.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return `${AUTHORITY}/${this.config.tenant}/oauth2/v2.0/authorize?${query.toString()}`;
  }

  private async waitForCode(listenerId: string, state: string): Promise<string> {
    try {
      return await this.deps.loopback.waitForCode(listenerId, state, this.config.loginTimeoutMs);
    } catch (error) {
      if (error instanceof PlatformCommandError) throw new ConnectionProblemError('microsoft-expired', error.message);
      throw error;
    }
  }

  private async requestTokens(form: Record<string, string>): Promise<TokenResponse> {
    const response = await this.deps.fetcher(`${AUTHORITY}/${this.config.tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await response.json()) as TokenResponse;
    if (body.access_token) return body;
    if (body.error && REAUTH_ERRORS.includes(body.error)) {
      throw new ConnectionProblemError('microsoft-expired', body.error_description?.split('\r\n')[0]);
    }
    throw new Error(body.error_description?.split('\r\n')[0] ?? `Microsoft respondeu ${response.status}`);
  }

  private async storeTokens(tokens: TokenResponse): Promise<void> {
    if (tokens.refresh_token) await this.deps.secrets.set(SECRET_KEYS.microsoftRefreshToken, tokens.refresh_token);
    const lifetimeMs = (tokens.expires_in ?? 0) * 1000;
    this.cached = tokens.access_token
      ? { token: tokens.access_token, expiresAt: this.deps.now() + lifetimeMs - EXPIRY_MARGIN_MS }
      : null;
  }
}
