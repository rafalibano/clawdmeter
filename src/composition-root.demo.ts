import { createApplication, type Application } from './application/application';
import type { ConnectionId } from './domain/connections';
import { createDemoConnectionAdapters, createDemoWorld } from './infrastructure/demo';
import { JsonSettingsStore, LocalStorageJsonFile } from './infrastructure/persistence';
import { SystemClock } from './infrastructure/platform/system-clock';
import { createExamplePage } from './ui/pages/example/example.page';

const CONNECTIONS_FOR_EXAMPLE: ConnectionId[] = ['claude', 'github', 'microsoft', 'notifications'];

export function createComposition(): Application {
  const clock = new SystemClock();
  const world = createDemoWorld(window.location.search);
  return createApplication({
    clock,
    settingsStore: new JsonSettingsStore(new LocalStorageJsonFile('dev-pulse.settings')),
    connectionAdapters: createDemoConnectionAdapters(world),
    pages: [createExamplePage({ clock, requiredConnections: CONNECTIONS_FOR_EXAMPLE })],
  });
}
