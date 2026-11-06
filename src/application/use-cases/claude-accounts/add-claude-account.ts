import type { ClaudeAccount } from '../../../domain/settings';
import type { ClaudeAccountDeps } from './claude-account-deps';
import type { ClaudeLogins, PendingLoginListener } from './claude-login';

export class AddClaudeAccount {
  constructor(
    private readonly deps: ClaudeAccountDeps,
    private readonly logins: ClaudeLogins,
  ) {}

  async execute(name: string, onPending?: PendingLoginListener): Promise<ClaudeAccount | null> {
    const { claude } = await this.deps.settings.load();
    const account = this.logins.newAccount(name, claude.accounts);
    const login = await this.logins.begin(account, 'add', onPending);
    return this.logins.waitForBrowser(login);
  }
}
