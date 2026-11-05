import type { GitHubAuthMethod } from '../../domain/connections';
import { SECRET_KEYS, type GitHubCliTokenSource, type SecretStore } from '../ports';

export class GitHubTokenResolver {
  constructor(
    private readonly cli: GitHubCliTokenSource,
    private readonly secrets: SecretStore,
  ) {}

  resolve(method: GitHubAuthMethod): Promise<string | null> {
    return method === 'gh-cli' ? this.cli.token() : this.secrets.get(SECRET_KEYS.githubToken);
  }
}
