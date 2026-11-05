import type { GitHubAccountGateway } from '../../application/ports';
import {
  ConnectionProblemError,
  GITHUB_ORG,
  parseSsoUrl,
  type GitHubAccount,
  type GitHubOrgAccess,
} from '../../domain/connections';
import type { FetchLike } from '../platform/tauri-fetch';

const API = 'https://api.github.com';

export class GitHubRestAccountGateway implements GitHubAccountGateway {
  constructor(private readonly fetcher: FetchLike) {}

  async inspect(token: string): Promise<GitHubAccount> {
    const user = await this.get('/user', token);
    if (user.status === 401) throw new ConnectionProblemError('github-unauthorized');
    if (!user.ok) throw new Error(`GitHub respondeu ${user.status} em /user`);
    const { login } = (await user.json()) as { login: string };
    const scopes = parseScopes(user.headers.get('x-oauth-scopes'));
    const org = await this.orgAccess(token);
    return org.ssoUrl === undefined
      ? { login, scopes, orgAccess: org.access }
      : { login, scopes, orgAccess: org.access, ssoUrl: org.ssoUrl };
  }

  private async orgAccess(token: string): Promise<{ access: GitHubOrgAccess; ssoUrl?: string }> {
    const membership = await this.get(`/user/memberships/orgs/${GITHUB_ORG}`, token);
    if (membership.ok) {
      const { state } = (await membership.json()) as { state?: string };
      return { access: state === 'active' ? 'ok' : 'not-member' };
    }
    const sso = membership.headers.get('x-github-sso');
    if (membership.status === 403 && sso !== null) {
      const ssoUrl = parseSsoUrl(sso);
      return ssoUrl === null ? { access: 'sso-required' } : { access: 'sso-required', ssoUrl };
    }
    if (membership.status === 403 || membership.status === 404) return { access: 'not-member' };
    if (membership.status === 401) throw new ConnectionProblemError('github-unauthorized');
    throw new Error(`GitHub respondeu ${membership.status} ao verificar a org`);
  }

  private get(path: string, token: string): Promise<Response> {
    return this.fetcher(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  }
}

export function parseScopes(header: string | null): string[] | null {
  if (header === null) return null;
  return header
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope !== '');
}
