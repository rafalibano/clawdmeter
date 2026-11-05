import type { ConnectionId } from '../../domain/connections';
import type { PageId } from '../../domain/settings';
import type { PageRef } from './page-ref';

export type PageComponent = new () => unknown;

export interface PageModule<T = unknown> extends PageRef<T> {
  id: PageId;
  title: string;
  requiredConnections: ConnectionId[];
  pollIntervalMs: number | null;
  load(): Promise<T>;
  component: PageComponent;
}
