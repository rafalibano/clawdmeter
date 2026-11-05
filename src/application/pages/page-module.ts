import type { ConnectionId } from '../../domain/connections';
import type { PageId } from '../../domain/settings';

export type PageComponent = new () => unknown;

export interface PageModule<T = unknown> {
  id: PageId;
  title: string;
  requiredConnections: ConnectionId[];
  pollIntervalMs: number | null;
  load(): Promise<T>;
  component: PageComponent;
}
