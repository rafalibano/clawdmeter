import type { Clock } from '../../../application/ports';
import type { PageModule } from '../../../application/pages';
import type { ConnectionId } from '../../../domain/connections';
import { ExampleComponent } from './example.component';
import { EXAMPLE_PAGE, type ExampleData } from './example-page-ref';

export function createExamplePage(deps: {
  clock: Clock;
  requiredConnections?: ConnectionId[];
}): PageModule<ExampleData> {
  let loads = 0;
  return {
    id: EXAMPLE_PAGE.id,
    title: 'Exemplo',
    requiredConnections: deps.requiredConnections ?? [],
    pollIntervalMs: 10_000,
    load: async () => ({ loadedAt: deps.clock.now(), loads: ++loads }),
    component: ExampleComponent,
  };
}
