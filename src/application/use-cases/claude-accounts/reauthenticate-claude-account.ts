import type { ClaudeAccount } from '../../../domain/settings';
import { requireAccount, type ClaudeAccountDeps } from './claude-account-deps';
import type { ClaudeLogins, PendingLoginListener } from './claude-login';

export class ReauthenticateClaudeAccount {
  constructor(
    private readonly deps: ClaudeAccountDeps,
    private readonly logins: ClaudeLogins,
  ) {}

  async execute(accountId: string, onPending?: PendingLoginListener): Promise<ClaudeAccount | null> {
    const { claude } = await this.deps.settings.load();
    const login = await this.logins.begin(requireAccount(claude.accounts, accountId), 'reauthenticate', onPending);
    return this.logins.waitForBrowser(login);
  }
}
