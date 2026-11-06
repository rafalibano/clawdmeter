import type { ClaudeLogins, PendingClaudeLogin } from './claude-login';

export class CancelClaudeLogin {
  constructor(private readonly logins: ClaudeLogins) {}

  execute(login: PendingClaudeLogin): Promise<void> {
    return this.logins.cancel(login);
  }
}
