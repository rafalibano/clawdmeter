import type { ClaudeLogins, PendingClaudeLogin } from './claude-login';

export class OpenClaudeLoginCodePage {
  constructor(private readonly logins: ClaudeLogins) {}

  execute(login: PendingClaudeLogin): Promise<void> {
    return this.logins.openCodePage(login);
  }
}
