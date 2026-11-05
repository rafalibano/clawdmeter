import type { GitHubAccountGateway } from '../../application/ports';
import { ConnectionProblemError, GITHUB_ORG, type GitHubAccount, type GitHubOrgAccess } from '../../domain/connections';
import type { FetchLike } from '../platform/tauri-fetch';

const API = 'https://api.github.com';

export class GitHubRestAccountGateway implements GitHubAccountGateway {
  constructor(private readonly fetcher: FetchLike) {}

  async inspect(token: string): Promise<GitHubAccount> {
    const user = await this.get('/user', token);
    if (user.status === 401) throw new ConnectionProblemError('github-unauthorized');
    if (!user.ok) throw new Error(`GitHub respondeu ${user.status} em /user`);
    const { login } = (await user.json()) as { login: string };
    return { login, scopes: parseScopes(user.headers.get('x-oauth-scopes')), orgAccess: await this.orgAccess(token) };
  }

  private async orgAccess(token: string): Promise<GitHubOrgAccess> {
    const membership = await this.get(`/user/memberships/orgs/${GITHUB_ORG}`, token);
    if (membership.ok) {
      const { state } = (await membership.json()) as { state?: string };
      return state === 'active' ? 'ok' : 'not-member';
    }
    if (membership.status === 403 && membership.headers.get('x-github-sso') !== null) return 'sso-required';
    if (membership.status === 403 || membership.status === 404) return 'not-member';
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
