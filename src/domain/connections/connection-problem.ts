import type { ErrorArgs, ErrorCode } from '../coded-error';

export type ConnectionProblem =
  | 'claude-no-account'
  | 'claude-signin-required'
  | 'github-unauthorized'
  | 'github-missing-scope'
  | 'github-org-access'
  | 'microsoft-expired'
  | 'microsoft-not-connected'
  | 'notifications-blocked'
  | 'notifications-unverifiable'
  | 'github-not-member'
  | 'unexpected';

export const CONNECTION_PROBLEMS: readonly ConnectionProblem[] = [
  'claude-no-account',
  'claude-signin-required',
  'github-unauthorized',
  'github-missing-scope',
  'github-org-access',
  'microsoft-expired',
  'microsoft-not-connected',
  'notifications-blocked',
  'notifications-unverifiable',
  'github-not-member',
  'unexpected',
];

export class ConnectionProblemError extends Error {
  constructor(
    readonly problem: ConnectionProblem,
    message?: string,
    readonly code?: ErrorCode,
    readonly args?: ErrorArgs,
  ) {
    super(message ?? problem);
    this.name = 'ConnectionProblemError';
  }
}

export function customMessage(error: ConnectionProblemError): string | undefined {
  return error.message === error.problem ? undefined : error.message;
}

export function claudeSignInRequired(account: string): ConnectionProblemError {
  return new ConnectionProblemError('claude-signin-required', undefined, 'claude-signin-required', { account });
}
