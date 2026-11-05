import { errorStatus, type ConnectionStatus } from './connection-status';

export type GitHubAuthMethod = 'gh-cli' | 'device-flow' | 'pat';

export const GITHUB_ORG = 'Mottu-ops';
export const GITHUB_REQUIRED_SCOPES: readonly string[] = ['repo', 'read:org'];

export type GitHubOrgAccess = 'ok' | 'sso-required' | 'not-member';

export interface GitHubAccount {
  login: string;
  scopes: string[] | null;
  orgAccess: GitHubOrgAccess;
}

export function missingScopes(account: GitHubAccount, required: readonly string[] = GITHUB_REQUIRED_SCOPES): string[] {
  if (account.scopes === null) return [];
  const granted = new Set(account.scopes);
  return required.filter((scope) => !granted.has(scope));
}

export function evaluateGitHubAccount(account: GitHubAccount): ConnectionStatus {
  const missing = missingScopes(account);
  if (missing.length > 0) return errorStatus('github-missing-scope', `Faltam: ${missing.join(', ')}`);
  if (account.orgAccess !== 'ok') return errorStatus('github-org-access');
  return { state: 'connected', account: account.login };
}
