import type { PageModule } from '../pages/page-module';

export class FakeComponent {}

export function fakePage(overrides: Partial<PageModule> = {}): PageModule {
  return {
    id: 'fake',
    title: 'Fake',
    requiredConnections: [],
    pollIntervalMs: null,
    load: async () => ({}),
    component: FakeComponent,
    ...overrides,
  };
}
