import { GITHUB_CLI_HINTS, errorStatus, evaluateGitHubAccount, type ConnectionStatus } from '../../../../domain/connections';
import type { GitHubTokenResolver } from '../../../connections/github-token-resolver';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { ConnectionPrefsStore, GitHubAccountGateway, GitHubCliTokenSource } from '../../../ports';

export class CheckGitHubConnection implements StatusUseCase {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly tokens: GitHubTokenResolver,
    private readonly accounts: GitHubAccountGateway,
    private readonly cli: GitHubCliTokenSource,
  ) {}

  async execute(): Promise<ConnectionStatus> {
    const { method } = (await this.prefs.load()).github;
    if (method === null) return this.probeCli();
    const token = await this.tokens.resolve(method);
    if (token === null) return errorStatus('github-unauthorized');
    return evaluateGitHubAccount(await this.accounts.inspect(token));
  }

  private async probeCli(): Promise<ConnectionStatus> {
    try {
      const result = await this.cli.token();
      if ('missing' in result) return { state: 'disconnected', hint: GITHUB_CLI_HINTS[result.missing], cli: result.missing };
    } catch {
      return { state: 'disconnected' };
    }
    return { state: 'disconnected' };
  }
}
