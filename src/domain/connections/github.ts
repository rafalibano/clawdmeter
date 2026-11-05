import { errorStatus, type ConnectionStatus } from './connection-status';

export type GitHubAuthMethod = 'gh-cli' | 'device-flow' | 'pat';

export const GITHUB_ORG = 'Mottu-ops';
export const GITHUB_REQUIRED_SCOPES: readonly string[] = ['repo', 'read:org'];

export type GitHubOrgAccess = 'ok' | 'sso-required' | 'not-member';

export interface GitHubAccount {
  login: string;
  scopes: string[] | null;
  orgAccess: GitHubOrgAccess;
  ssoUrl?: string;
}

const IMPLIED_SCOPES: Readonly<Record<string, readonly string[]>> = {
  'admin:org': ['write:org', 'read:org'],
  'write:org': ['read:org'],
  repo: ['repo:status', 'repo_deployment', 'public_repo', 'repo:invite', 'security_events'],
};

function expandScopes(scopes: readonly string[]): Set<string> {
  const expanded = new Set<string>();
  for (const scope of scopes) {
    expanded.add(scope);
    for (const implied of IMPLIED_SCOPES[scope] ?? []) expanded.add(implied);
  }
  return expanded;
}

export function missingScopes(account: GitHubAccount, required: readonly string[] = GITHUB_REQUIRED_SCOPES): string[] {
  if (account.scopes === null) return [];
  const granted = expandScopes(account.scopes);
  return required.filter((scope) => !granted.has(scope));
}

export function parseSsoUrl(header: string | null): string | null {
  const raw = header?.match(/url=([^\s;,]+)/)?.[1];
  if (raw === undefined) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.username === '' && url.port === ''
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function evaluateGitHubAccount(account: GitHubAccount): ConnectionStatus {
  const missing = missingScopes(account);
  if (missing.length > 0) return errorStatus('github-missing-scope', `Faltam: ${missing.join(', ')}`);
  if (account.orgAccess === 'not-member') return errorStatus('github-not-member');
  if (account.orgAccess === 'sso-required') return errorStatus('github-org-access');
  return { state: 'connected', account: account.login };
}
