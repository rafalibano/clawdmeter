import { invoke } from '@tauri-apps/api/core';
import { CodedError } from '../../domain/coded-error';
import { ConnectionProblemError } from '../../domain/connections';
import { RateLimitedError } from '../../domain/rate-limit';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export class PlatformCommandError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformCommandError';
  }
}

function isCommandError(raw: unknown): raw is { kind: string; message: string; retryAfterSecs?: number } {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { kind?: unknown }).kind === 'string' &&
    typeof (raw as { message?: unknown }).message === 'string'
  );
}

export function toDomainError(raw: unknown): Error {
  if (!isCommandError(raw)) return raw instanceof Error ? raw : new Error(String(raw));
  switch (raw.kind) {
    case 'claude_signin_required':
      return new ConnectionProblemError('claude-signin-required', raw.message);
    case 'keychain':
      return new ConnectionProblemError('unexpected', raw.message, 'keychain-unavailable');
    case 'keyring_unavailable':
      return new ConnectionProblemError('unexpected', raw.message, 'keyring-unavailable');
    case 'rate_limited':
      return new RateLimitedError(
        typeof raw.retryAfterSecs === 'number' && raw.retryAfterSecs > 0 ? raw.retryAfterSecs * 1_000 : null,
      );
    case 'too_many_processes':
      return new CodedError('too-many-processes');
    default:
      return new PlatformCommandError(raw.kind, raw.message);
  }
}

export class TauriCommands {
  constructor(private readonly rawInvoke: Invoke = invoke) {}

  async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await this.rawInvoke<T>(command, args);
    } catch (error) {
      throw toDomainError(error);
    }
  }
}
