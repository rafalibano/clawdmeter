import type { Clock } from '../../../application/ports';
import type { PageModule } from '../../../application/pages';
import { ExampleComponent } from './example.component';
import { EXAMPLE_PAGE, type ExampleData } from './example-page-ref';

export function createExamplePage(deps: { clock: Clock }): PageModule<ExampleData> {
  let loads = 0;
  return {
    id: EXAMPLE_PAGE.id,
    title: 'Exemplo',
    requiredConnections: [],
    pollIntervalMs: 10_000,
    load: async () => ({ loadedAt: deps.clock.now(), loads: ++loads }),
    component: ExampleComponent,
  };
}
