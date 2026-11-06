import type { ErrorArgs, ErrorCode } from '../coded-error';
import type { ConnectionProblem } from './connection-problem';
import type { GitHubCliStep } from './github';

export type StatusNote =
  | 'github-cli-not-logged-in'
  | 'github-cli-not-installed'
  | 'after-terminal'
  | 'after-install'
  | 'after-reset'
  | 'authorize-org'
  | 'ask-invite'
  | 'enable-notifications'
  | 'notifications-not-authorized'
  | 'missing-scopes';

export type ConnectionStatus =
  | { state: 'unknown' }
  | { state: 'checking' }
  | { state: 'disconnected'; note?: StatusNote; cli?: GitHubCliStep }
  | { state: 'connected'; account?: string; detail?: string }
  | { state: 'error'; problem: ConnectionProblem; message?: string; code?: ErrorCode; args?: ErrorArgs; note?: StatusNote; noteArg?: string };

export const UNKNOWN_STATUS: ConnectionStatus = { state: 'unknown' };

export function errorStatus(problem: ConnectionProblem, message?: string): ConnectionStatus {
  return message === undefined ? { state: 'error', problem } : { state: 'error', problem, message };
}

export function noteStatus(problem: ConnectionProblem, note: StatusNote, noteArg?: string): ConnectionStatus {
  return noteArg === undefined ? { state: 'error', problem, note } : { state: 'error', problem, note, noteArg };
}

export function statusForProblem(problem: ConnectionProblem, message?: string, code?: ErrorCode, args?: ErrorArgs): ConnectionStatus {
  if (problem === 'microsoft-not-connected') return { state: 'disconnected' };
  const status = errorStatus(problem, message);
  if (status.state !== 'error' || code === undefined) return status;
  return { ...status, code, ...(args ? { args } : {}) };
}

export function claudeSignInStatus(account: string): ConnectionStatus {
  return statusForProblem('claude-signin-required', undefined, 'claude-signin-required', { account });
}
