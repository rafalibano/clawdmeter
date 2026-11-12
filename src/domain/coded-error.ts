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
  | 'client-id-missing'
  | 'claude-signin-required'
  | 'claude-account-name-empty'
  | 'claude-account-name-too-long'
  | 'claude-account-name-taken'
  | 'claude-account-limit'
  | 'claude-account-missing'
  | 'claude-client-id-invalid'
  | 'claude-login-code-empty'
  | 'claude-login-code-invalid'
  | 'claude-login-busy'
  | 'keychain-unavailable'
  | 'keyring-unavailable'
  | 'claude-login-timeout'
  | 'claude-login-cancelled'
  | 'claude-login-rate-limited'
  | 'claude-login-failed';

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
