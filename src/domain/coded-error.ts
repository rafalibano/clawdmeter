export type ErrorCode =
  | 'usage-disconnected'
  | 'github-not-connected'
  | 'skill-running'
  | 'skill-unknown'
  | 'skill-no-session'
  | 'link-invalid-meeting'
  | 'link-invalid-github'
  | 'meeting-open-failed'
  | 'too-many-processes'
  | 'github-token-empty'
  | 'github-access-denied'
  | 'github-code-expired'
  | 'github-oauth-misconfigured'
  | 'github-login-failed'
  | 'github-rate-limited'
  | 'microsoft-calendar-denied'
  | 'client-id-missing';

export type ErrorArgs = Record<string, string | number>;

export class CodedError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly args?: ErrorArgs,
  ) {
    super(code);
    this.name = 'CodedError';
  }
}
