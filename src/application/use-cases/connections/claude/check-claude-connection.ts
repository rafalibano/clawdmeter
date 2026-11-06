import { claudeSignInStatus, errorStatus, type ConnectionStatus } from '../../../../domain/connections';
import { activeClaudeAccount } from '../../../../domain/settings';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { ClaudeAccountGateway, ConnectionPrefsStore, SettingsStore } from '../../../ports';

export class CheckClaudeConnection implements StatusUseCase {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly settings: Pick<SettingsStore, 'load'>,
    private readonly accounts: ClaudeAccountGateway,
  ) {}

  async execute(): Promise<ConnectionStatus> {
    if (!(await this.prefs.load()).claude.enabled) return { state: 'disconnected' };
    const account = activeClaudeAccount((await this.settings.load()).claude);
    if (account === null) return errorStatus('claude-no-account');
    const status = await this.accounts.status(account.id);
    if (!status.signedIn || status.needsLogin) return claudeSignInStatus(account.name);
    return { state: 'connected', account: account.name };
  }
}
