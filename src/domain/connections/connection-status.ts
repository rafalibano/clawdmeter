import type { ConnectionProblem } from './connection-problem';

export type ConnectionStatus =
  | { state: 'unknown' }
  | { state: 'checking' }
  | { state: 'disconnected'; hint?: string }
  | { state: 'connected'; account?: string; detail?: string }
  | { state: 'error'; problem: ConnectionProblem; message?: string };

export const UNKNOWN_STATUS: ConnectionStatus = { state: 'unknown' };

export function errorStatus(problem: ConnectionProblem, message?: string): ConnectionStatus {
  return message === undefined ? { state: 'error', problem } : { state: 'error', problem, message };
}
