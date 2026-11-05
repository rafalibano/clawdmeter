import { UNKNOWN_STATUS, type ConnectionId, type ConnectionStatus } from '../../domain/connections';
import type { Unsubscribe } from '../ports';

type StatusListener = (id: ConnectionId, status: ConnectionStatus) => void;

export class ConnectionMonitor {
  private readonly statuses = new Map<ConnectionId, ConnectionStatus>();
  private readonly listeners = new Set<StatusListener>();

  get(id: ConnectionId): ConnectionStatus {
    return this.statuses.get(id) ?? UNKNOWN_STATUS;
  }

  set(id: ConnectionId, status: ConnectionStatus): void {
    this.statuses.set(id, status);
    for (const listener of this.listeners) listener(id, status);
  }

  subscribe(listener: StatusListener): Unsubscribe {
    this.listeners.add(listener);
    for (const [id, status] of this.statuses) listener(id, status);
    return () => this.listeners.delete(listener);
  }
}
