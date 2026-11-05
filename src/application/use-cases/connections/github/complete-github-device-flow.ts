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
  type UrlOpener,
} from '../../../ports';

export class CompleteGitHubDeviceFlow {
  constructor(
    private readonly flow: GitHubDeviceFlow,
    private readonly secrets: SecretStore,
    private readonly prefs: ConnectionPrefsStore,
    private readonly accounts: GitHubAccountGateway,
    private readonly runner: ConnectionRunner,
    private readonly urls: UrlOpener,
  ) {}

  execute(code: DeviceCode, signal?: AbortSignal): Promise<ConnectionStatus> {
    return this.runner.run('github', async () => {
      try {
        await this.urls.open(code.verificationUri);
        const token = await this.flow.complete(code, signal);
        const account = await this.accounts.inspect(token);
        await this.secrets.set(SECRET_KEYS.githubToken, token);
        await updatePrefs(this.prefs, (current) => ({ ...current, github: { method: 'device-flow' } }));
        return evaluateGitHubAccount(account);
      } catch (error) {
        if (signal?.aborted) return { state: 'disconnected' };
        throw error;
      }
    });
  }
}
