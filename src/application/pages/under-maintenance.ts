import type { PageComponent, PageModule } from './page-module';

export function underMaintenance<T>(page: PageModule<T>, component: PageComponent): PageModule<T> {
  return {
    ...page,
    requiredConnections: [],
    pollIntervalMs: null,
    load: async () => undefined as T,
    component,
  };
}
