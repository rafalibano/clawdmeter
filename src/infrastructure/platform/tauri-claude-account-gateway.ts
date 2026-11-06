import type {
  ClaudeAccountGateway,
  ClaudeAccountStatus,
  ClaudeLoginRequest,
  ClaudeLoginResult,
  ClaudeLoginStart,
} from '../../application/ports';
import { CodedError, type ErrorCode } from '../../domain/coded-error';
import { ConnectionProblemError } from '../../domain/connections';
import { RateLimitedError } from '../../domain/rate-limit';
import { PlatformCommandError, type TauriCommands } from './tauri-commands';

const BEGIN_ERRORS: Readonly<Record<string, ErrorCode>> = {
  invalid_argument: 'claude-client-id-invalid',
};

const WAIT_ERRORS: Readonly<Record<string, ErrorCode>> = {
  timeout: 'claude-login-timeout',
  cancelled: 'claude-login-cancelled',
};

const PASTE_ERRORS: Readonly<Record<string, ErrorCode>> = {
  invalid_argument: 'claude-login-code-invalid',
  state_mismatch: 'claude-login-code-invalid',
  cancelled: 'claude-login-cancelled',
};

function loginError(error: unknown, known: Readonly<Record<string, ErrorCode>>): unknown {
  if (error instanceof CodedError && error.code === 'too-many-processes') return new CodedError('claude-login-busy');
  if (error instanceof RateLimitedError) return new CodedError('claude-login-rate-limited');
  if (error instanceof ConnectionProblemError && error.code !== undefined) return error;
  if (error instanceof CodedError) return error;
  const kind = error instanceof PlatformCommandError ? error.kind : '';
  return new CodedError(known[kind] ?? 'claude-login-failed');
}

export class TauriClaudeAccountGateway implements ClaudeAccountGateway {
  constructor(private readonly commands: TauriCommands) {}

  async begin(clientId: string): Promise<ClaudeLoginStart> {
    try {
      return await this.commands.call<ClaudeLoginStart>('claude_oauth_begin', { clientId });
    } catch (error) {
      throw loginError(error, BEGIN_ERRORS);
    }
  }

  async complete(request: ClaudeLoginRequest): Promise<ClaudeLoginResult> {
    const { loginId, accountId, code, timeoutMs } = request;
    const args: Record<string, unknown> = { loginId, accountId };
    if (code !== undefined) args['code'] = code;
    if (timeoutMs !== undefined) args['timeoutMs'] = timeoutMs;
    try {
      return await this.commands.call<ClaudeLoginResult>('claude_oauth_complete', args);
    } catch (error) {
      throw loginError(error, code === undefined ? WAIT_ERRORS : PASTE_ERRORS);
    }
  }

  cancel(loginId: string): Promise<void> {
    return this.commands.call<void>('claude_oauth_cancel', { loginId });
  }

  status(accountId: string): Promise<ClaudeAccountStatus> {
    return this.commands.call<ClaudeAccountStatus>('claude_account_status', { accountId });
  }

  remove(accountId: string): Promise<void> {
    return this.commands.call<void>('claude_account_remove', { accountId });
  }
}
