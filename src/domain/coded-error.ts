export type ErrorCode =
  | 'usage-disconnected'
  | 'github-not-connected'
  | 'skill-running'
  | 'skill-unknown'
  | 'skill-no-session'
  | 'link-invalid-meeting'
  | 'link-invalid-github'
  | 'meeting-open-failed';

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
