import {
  ConnectionProblemError,
  problemMessage,
  errorStatus,
  statusForProblem,
  type ConnectionId,
  type ConnectionStatus,
} from '../../domain/connections';
import type { ConnectionMonitor } from './connection-monitor';

export interface StatusUseCase<I = void> {
  execute(input: I): Promise<ConnectionStatus>;
}

export function statusFromError(error: unknown): ConnectionStatus {
  if (error instanceof ConnectionProblemError) {
    return statusForProblem(error.problem, problemMessage(error));
  }
  const detail = error instanceof Error ? error.message : String(error);
  return errorStatus('unexpected', detail);
}

export class ConnectionRunner {
  constructor(private readonly monitor: ConnectionMonitor) {}

  async run(id: ConnectionId, work: () => Promise<ConnectionStatus>): Promise<ConnectionStatus> {
    this.monitor.set(id, { state: 'checking' });
    let status: ConnectionStatus;
    try {
      status = await work();
    } catch (error) {
      status = statusFromError(error);
    }
    this.monitor.set(id, status);
    return status;
  }
}
