import { evaluateGitHubAccount, type ConnectionStatus } from '../../../../domain/connections';
import { updatePrefs } from '../../../connections/update-prefs';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { ConnectionPrefsStore, GitHubAccountGateway, GitHubCliTokenSource } from '../../../ports';

const CLI_UNAVAILABLE_HINT = 'gh CLI sem login. Entre com o código do GitHub ou cole um token.';

export class ConnectGitHub implements StatusUseCase {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly cli: GitHubCliTokenSource,
    private readonly accounts: GitHubAccountGateway,
  ) {}

  async execute(): Promise<ConnectionStatus> {
    const token = await this.cli.token();
    if (token === null) return { state: 'disconnected', hint: CLI_UNAVAILABLE_HINT };
    const status = evaluateGitHubAccount(await this.accounts.inspect(token));
    await updatePrefs(this.prefs, (current) => ({ ...current, github: { method: 'gh-cli' } }));
    return status;
  }
}
