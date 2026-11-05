export type ConnectionProblem =
  | 'keychain-denied'
  | 'claude-expired'
  | 'claude-code-missing'
  | 'github-unauthorized'
  | 'github-missing-scope'
  | 'github-org-access'
  | 'microsoft-expired'
  | 'microsoft-not-connected'
  | 'notifications-blocked'
  | 'unexpected';

export const CONNECTION_PROBLEMS: readonly ConnectionProblem[] = [
  'keychain-denied',
  'claude-expired',
  'claude-code-missing',
  'github-unauthorized',
  'github-missing-scope',
  'github-org-access',
  'microsoft-expired',
  'microsoft-not-connected',
  'notifications-blocked',
  'unexpected',
];

export class ConnectionProblemError extends Error {
  constructor(
    readonly problem: ConnectionProblem,
    message?: string,
  ) {
    super(message ?? problem);
    this.name = 'ConnectionProblemError';
  }
}
