import type { PageId } from '../../domain/settings';

export interface PageRef<T = unknown> {
  readonly id: PageId;
  readonly load?: () => Promise<T>;
}

export function pageRef<T>(id: PageId): PageRef<T> {
  return { id };
}
