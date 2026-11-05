import { ConnectionProblemError } from '../../domain/connections';

export interface AuthConfig {
  github: { clientId: string; scopes: string[] };
  microsoft: { clientId: string; tenant: string; scopes: string[]; loginTimeoutMs: number };
}

export const PLACEHOLDER_PREFIX = 'REPLACE_WITH_';

export const AUTH_CONFIG: AuthConfig = {
  github: {
    clientId: 'REPLACE_WITH_GITHUB_OAUTH_APP_CLIENT_ID',
    scopes: ['repo', 'read:org'],
  },
  microsoft: {
    clientId: 'REPLACE_WITH_ENTRA_PUBLIC_CLIENT_ID',
    tenant: 'organizations',
    scopes: ['openid', 'profile', 'offline_access', 'Calendars.Read'],
    loginTimeoutMs: 120_000,
  },
};

export function isConfigured(clientId: string): boolean {
  return clientId.trim() !== '' && !clientId.startsWith(PLACEHOLDER_PREFIX);
}

export function requireClientId(clientId: string, provider: string): string {
  if (!isConfigured(clientId)) {
    throw new ConnectionProblemError('unexpected', `client_id do ${provider} não configurado em auth-config.ts`);
  }
  return clientId;
}
