import {
  connectionDefinition,
  errorStatus,
  type ConnectionId,
  type ConnectionProblem,
  type ConnectionStatus,
  type FixAction,
} from '../../../domain/connections';
import type { ConnectionMonitor } from '../../connections/connection-monitor';
import type { ConnectionRunner, StatusUseCase } from '../../connections/connection-runner';

export class CheckConnection {
  constructor(
    private readonly checks: Record<ConnectionId, StatusUseCase>,
    private readonly runner: ConnectionRunner,
  ) {}

  execute(id: ConnectionId): Promise<ConnectionStatus> {
    return this.runner.run(id, () => this.checks[id].execute());
  }
}

export class CheckConnections {
  constructor(private readonly check: CheckConnection) {}

  async execute(ids: readonly ConnectionId[]): Promise<void> {
    await Promise.all(ids.map((id) => this.check.execute(id)));
  }
}

export class ConnectConnection {
  constructor(
    private readonly connects: Record<ConnectionId, StatusUseCase>,
    private readonly runner: ConnectionRunner,
  ) {}

  execute(id: ConnectionId): Promise<ConnectionStatus> {
    return this.runner.run(id, () => this.connects[id].execute());
  }
}

export class DisconnectConnection {
  constructor(
    private readonly disconnects: Partial<Record<ConnectionId, StatusUseCase>>,
    private readonly runner: ConnectionRunner,
  ) {}

  execute(id: ConnectionId): Promise<ConnectionStatus> {
    const disconnect = this.disconnects[id];
    if (!connectionDefinition(id).disconnectable || !disconnect) {
      return Promise.reject(new Error(`A conexão ${id} não pode ser desconectada`));
    }
    return this.runner.run(id, () => disconnect.execute());
  }
}

export class FixConnection {
  constructor(
    private readonly fixes: Record<ConnectionId, StatusUseCase<FixAction>>,
    private readonly runner: ConnectionRunner,
  ) {}

  execute(id: ConnectionId, fix: FixAction): Promise<ConnectionStatus> {
    return this.runner.run(id, () => this.fixes[id].execute(fix));
  }
}

export class ReportConnectionProblem {
  constructor(private readonly monitor: ConnectionMonitor) {}

  execute(id: ConnectionId, problem: ConnectionProblem, message?: string): void {
    this.monitor.set(id, errorStatus(problem, message));
  }
}
