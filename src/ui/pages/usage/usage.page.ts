import type { PageModule } from '../../../application/pages';
import type { LoadUsage, UsageData } from '../../../application/use-cases';
import { UsageComponent } from './usage.component';
import { USAGE_PAGE } from './usage-page-ref';

export const USAGE_POLL_INTERVAL_MS = 5 * 60_000;

export function createUsagePage(deps: { loadUsage: LoadUsage }): PageModule<UsageData> {
  return {
    id: USAGE_PAGE.id,
    title: 'Usage',
    requiredConnections: ['claude'],
    pollIntervalMs: USAGE_POLL_INTERVAL_MS,
    load: () => deps.loadUsage.execute(),
    component: UsageComponent,
  };
}
