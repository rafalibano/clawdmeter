import { effectiveClaudeClientId, type ClaudeAccount } from '../../../domain/settings';
import type { ClaudeAccountStatus } from '../../ports';
import type { ClaudeAccountDeps } from './claude-account-deps';

export interface ClaudeAccountEntry {
  account: ClaudeAccount;
  active: boolean;
  status: ClaudeAccountStatus | null;
}

export interface ClaudeAccountListing {
  clientId: string;
  activeAccountId: string | null;
  accounts: ClaudeAccountEntry[];
}

export class ListClaudeAccounts {
  constructor(private readonly deps: ClaudeAccountDeps) {}

  async execute(): Promise<ClaudeAccountListing> {
    const { claude } = await this.deps.settings.load();
    const accounts = await Promise.all(
      claude.accounts.map(async (account) => ({
        account,
        active: account.id === claude.activeAccountId,
        status: await this.deps.gateway.status(account.id).catch(() => null),
      })),
    );
    return { clientId: effectiveClaudeClientId(claude), activeAccountId: claude.activeAccountId, accounts };
  }
}
