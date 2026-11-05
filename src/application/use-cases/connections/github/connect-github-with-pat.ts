import { ConnectionProblemError, evaluateGitHubAccount, type ConnectionStatus } from '../../../../domain/connections';
import type { ConnectionRunner } from '../../../connections/connection-runner';
import { updatePrefs } from '../../../connections/update-prefs';
import { SECRET_KEYS, type ConnectionPrefsStore, type GitHubAccountGateway, type SecretStore } from '../../../ports';

export class ConnectGitHubWithPat {
  constructor(
    private readonly secrets: SecretStore,
    private readonly prefs: ConnectionPrefsStore,
    private readonly accounts: GitHubAccountGateway,
    private readonly runner: ConnectionRunner,
  ) {}

  execute(pat: string): Promise<ConnectionStatus> {
    return this.runner.run('github', async () => {
      const token = pat.trim();
      if (token === '') throw new ConnectionProblemError('github-unauthorized', 'Cole um token de acesso pessoal.');
      const account = await this.accounts.inspect(token);
      await this.secrets.set(SECRET_KEYS.githubToken, token);
      await updatePrefs(this.prefs, (current) => ({ ...current, github: { method: 'pat' } }));
      return evaluateGitHubAccount(account);
    });
  }
}
