import type { ConnectionProblem } from './connection-problem';
import type { GitHubCliStep } from './github';

export type ConnectionStatus =
  | { state: 'unknown' }
  | { state: 'checking' }
  | { state: 'disconnected'; hint?: string; cli?: GitHubCliStep }
  | { state: 'connected'; account?: string; detail?: string }
  | { state: 'error'; problem: ConnectionProblem; message?: string };

export const UNKNOWN_STATUS: ConnectionStatus = { state: 'unknown' };

export function errorStatus(problem: ConnectionProblem, message?: string): ConnectionStatus {
  return message === undefined ? { state: 'error', problem } : { state: 'error', problem, message };
}

export function statusForProblem(problem: ConnectionProblem, message?: string): ConnectionStatus {
  return problem === 'microsoft-not-connected' ? { state: 'disconnected' } : errorStatus(problem, message);
}
