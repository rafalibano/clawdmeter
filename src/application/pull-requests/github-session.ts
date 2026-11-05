import { ConnectionProblemError } from '../../domain/connections';
import type { ConnectionPrefsStore } from '../ports';
import type { GitHubTokenResolver } from '../connections/github-token-resolver';

const NOT_CONNECTED = 'GitHub não conectado. Conecte em Ajustes, na seção Conexões.';

export class GitHubSession {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly tokens: GitHubTokenResolver,
  ) {}

  async token(): Promise<string> {
    const { method } = (await this.prefs.load()).github;
    if (method === null) throw new ConnectionProblemError('github-unauthorized', NOT_CONNECTED);
    const token = await this.tokens.resolve(method);
    if (token === null) throw new ConnectionProblemError('github-unauthorized');
    return token;
  }
}
