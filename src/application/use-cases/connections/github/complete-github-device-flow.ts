import { evaluateGitHubAccount, type ConnectionStatus } from '../../../../domain/connections';
import type { ConnectionRunner } from '../../../connections/connection-runner';
import { updatePrefs } from '../../../connections/update-prefs';
import {
  SECRET_KEYS,
  type ConnectionPrefsStore,
  type DeviceCode,
  type GitHubAccountGateway,
  type GitHubDeviceFlow,
  type SecretStore,
} from '../../../ports';

export class CompleteGitHubDeviceFlow {
  constructor(
    private readonly flow: GitHubDeviceFlow,
    private readonly secrets: SecretStore,
    private readonly prefs: ConnectionPrefsStore,
    private readonly accounts: GitHubAccountGateway,
    private readonly runner: ConnectionRunner,
  ) {}

  execute(code: DeviceCode): Promise<ConnectionStatus> {
    return this.runner.run('github', async () => {
      const token = await this.flow.complete(code);
      const account = await this.accounts.inspect(token);
      await this.secrets.set(SECRET_KEYS.githubToken, token);
      await updatePrefs(this.prefs, (current) => ({ ...current, github: { method: 'device-flow' } }));
      return evaluateGitHubAccount(account);
    });
  }
}
