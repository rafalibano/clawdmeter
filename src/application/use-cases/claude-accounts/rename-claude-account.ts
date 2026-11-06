import { cleanAccountName, type ClaudeAccount } from '../../../domain/settings';
import { checkedName, requireAccount, type ClaudeAccountDeps } from './claude-account-deps';

export class RenameClaudeAccount {
  constructor(private readonly deps: ClaudeAccountDeps) {}

  async execute(accountId: string, name: string): Promise<ClaudeAccount> {
    await this.deps.updateSettings.execute((current) => {
      const { accounts } = current.claude;
      requireAccount(accounts, accountId);
      const checked = checkedName(name, accounts, accountId);
      return { claude: { accounts: accounts.map((account) => (account.id === accountId ? { id: accountId, name: checked } : account)) } };
    });
    return { id: accountId, name: cleanAccountName(name) };
  }
}
