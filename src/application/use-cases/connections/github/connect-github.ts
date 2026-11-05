import { GITHUB_CLI_HINTS, evaluateGitHubAccount, type ConnectionStatus } from '../../../../domain/connections';
import { updatePrefs } from '../../../connections/update-prefs';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { ConnectionPrefsStore, GitHubAccountGateway, GitHubCliTokenSource } from '../../../ports';

export class ConnectGitHub implements StatusUseCase {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly cli: GitHubCliTokenSource,
    private readonly accounts: GitHubAccountGateway,
  ) {}

  async execute(): Promise<ConnectionStatus> {
    const result = await this.cli.token();
    if ('missing' in result) return { state: 'disconnected', hint: GITHUB_CLI_HINTS[result.missing], cli: result.missing };
    const status = evaluateGitHubAccount(await this.accounts.inspect(result.token));
    await updatePrefs(this.prefs, (current) => ({ ...current, github: { method: 'gh-cli' } }));
    return status;
  }
}
