import { ConnectionProblemError } from '../../domain/connections';
import type { ConnectionPrefsStore } from '../ports';
import type { GitHubTokenResolver } from '../connections/github-token-resolver';

export class GitHubSession {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly tokens: GitHubTokenResolver,
  ) {}

  async token(): Promise<string> {
    const { method } = (await this.prefs.load()).github;
    if (method === null) throw new ConnectionProblemError('github-unauthorized', undefined, 'github-not-connected');
    const token = await this.tokens.resolve(method);
    if (token === null) throw new ConnectionProblemError('github-unauthorized');
    return token;
  }
}
