import type { GitHubAuthMethod } from '../../domain/connections';
import { SECRET_KEYS, type GitHubCliTokenSource, type SecretStore } from '../ports';

export class GitHubTokenResolver {
  constructor(
    private readonly cli: GitHubCliTokenSource,
    private readonly secrets: SecretStore,
  ) {}

  async resolve(method: GitHubAuthMethod): Promise<string | null> {
    if (method !== 'gh-cli') return this.secrets.get(SECRET_KEYS.githubToken);
    const result = await this.cli.token();
    return 'token' in result ? result.token : null;
  }
}
