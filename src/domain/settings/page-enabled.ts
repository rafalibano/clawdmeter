import type { AppSettings } from './app-settings';
import type { PageId } from './page-id';

export function isPageEnabled(settings: AppSettings, id: PageId): boolean {
  return settings.enabledPages[id] ?? true;
}
