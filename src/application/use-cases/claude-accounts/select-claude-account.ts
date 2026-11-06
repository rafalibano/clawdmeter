import { requireAccount, type ClaudeAccountDeps } from './claude-account-deps';

export class SelectClaudeAccount {
  constructor(private readonly deps: ClaudeAccountDeps) {}

  async execute(accountId: string): Promise<void> {
    await this.deps.updateSettings.execute((current) => {
      requireAccount(current.claude.accounts, accountId);
      return { claude: { activeAccountId: accountId } };
    });
  }
}
