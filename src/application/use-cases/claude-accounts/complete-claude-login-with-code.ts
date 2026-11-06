import type { ClaudeAccount } from '../../../domain/settings';
import type { ClaudeLogins, PendingClaudeLogin } from './claude-login';

export class CompleteClaudeLoginWithCode {
  constructor(private readonly logins: ClaudeLogins) {}

  execute(login: PendingClaudeLogin, code: string): Promise<ClaudeAccount | null> {
    return this.logins.withCode(login, code);
  }
}
