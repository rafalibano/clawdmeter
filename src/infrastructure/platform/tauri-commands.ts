import { invoke } from '@tauri-apps/api/core';
import { ConnectionProblemError } from '../../domain/connections';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export const TOO_MANY_PROCESSES_MESSAGE =
  'Há processos demais em andamento. Aguarde uma run terminar e tente de novo.';

export class PlatformCommandError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformCommandError';
  }
}

function isCommandError(raw: unknown): raw is { kind: string; message: string } {
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
    case 'keychain_denied':
      return new ConnectionProblemError('keychain-denied', raw.message);
    case 'claude_code_missing':
      return new ConnectionProblemError('claude-code-missing', raw.message);
    case 'claude_expired':
      return new ConnectionProblemError('claude-expired', raw.message);
    case 'too_many_processes':
      return new PlatformCommandError(raw.kind, TOO_MANY_PROCESSES_MESSAGE);
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
