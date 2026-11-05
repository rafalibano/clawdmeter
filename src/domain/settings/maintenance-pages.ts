import type { PageId } from './page-id';

export const MAINTENANCE_PAGES: readonly PageId[] = ['teams', 'skills'];

export function isMaintenancePage(id: PageId): boolean {
  return MAINTENANCE_PAGES.includes(id);
}

export function maintenancePagesOff(): Record<PageId, boolean> {
  return Object.fromEntries(MAINTENANCE_PAGES.map((id) => [id, false]));
}
