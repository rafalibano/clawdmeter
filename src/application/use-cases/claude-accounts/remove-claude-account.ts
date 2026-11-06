import { requireAccount, type ClaudeAccountDeps } from './claude-account-deps';
import type { ClaudeLogins } from './claude-login';

export class RemoveClaudeAccount {
  constructor(
    private readonly deps: ClaudeAccountDeps,
    private readonly logins: ClaudeLogins,
  ) {}

  async execute(accountId: string): Promise<void> {
    requireAccount((await this.deps.settings.load()).claude.accounts, accountId);
    await this.logins.cancelFor(accountId);
    await this.deps.gateway.remove(accountId);
    await this.deps.updateSettings.execute((current) => ({
      claude: { accounts: current.claude.accounts.filter((account) => account.id !== accountId) },
    }));
    await this.deps.histories.remove(accountId).catch(() => undefined);
  }
}
