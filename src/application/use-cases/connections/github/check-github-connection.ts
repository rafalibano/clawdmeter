import { errorStatus, evaluateGitHubAccount, type ConnectionStatus } from '../../../../domain/connections';
import type { GitHubTokenResolver } from '../../../connections/github-token-resolver';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { ConnectionPrefsStore, GitHubAccountGateway } from '../../../ports';

export class CheckGitHubConnection implements StatusUseCase {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly tokens: GitHubTokenResolver,
    private readonly accounts: GitHubAccountGateway,
  ) {}

  async execute(): Promise<ConnectionStatus> {
    const { method } = (await this.prefs.load()).github;
    if (method === null) return { state: 'disconnected' };
    const token = await this.tokens.resolve(method);
    if (token === null) return errorStatus('github-unauthorized');
    return evaluateGitHubAccount(await this.accounts.inspect(token));
  }
}
