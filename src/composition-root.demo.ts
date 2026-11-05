import { createApplication, type Application } from './application/application';
import { LoadSessions, LoadUsage } from './application/use-cases';
import type { ConnectionId } from './domain/connections';
import { DEFAULT_ATTENTION_CONFIG } from './domain/sessions';
import {
  DemoProcessProbe,
  DemoSessionDirectory,
  DemoUsageGateway,
  DemoUsageHistoryStore,
  DemoUsageModel,
  createDemoConnectionAdapters,
  createDemoWorld,
} from './infrastructure/demo';
import { JsonSettingsStore, LocalStorageJsonFile } from './infrastructure/persistence';
import { SystemClock } from './infrastructure/platform/system-clock';
import { createExamplePage } from './ui/pages/example/example.page';
import { createSessionsPage } from './ui/pages/sessions/sessions.page';
import { createUsagePage } from './ui/pages/usage/usage.page';

const CONNECTIONS_FOR_EXAMPLE: ConnectionId[] = ['claude', 'github', 'microsoft', 'notifications'];

export function createComposition(): Application {
  const clock = new SystemClock();
  const world = createDemoWorld(window.location.search);
  const connectionAdapters = createDemoConnectionAdapters(world);
  const origin = clock.now();
  const usageModel = new DemoUsageModel(origin);
  return createApplication({
    clock,
    settingsStore: new JsonSettingsStore(new LocalStorageJsonFile('dev-pulse.settings')),
    connectionAdapters,
    pages: ({ connections }) => [
      createUsagePage({
        loadUsage: new LoadUsage(
          connectionAdapters.prefs,
          connectionAdapters.claudeCredentials,
          new DemoUsageGateway(usageModel, () => clock.now()),
          new DemoUsageHistoryStore(usageModel.history(origin)),
          clock,
          connections,
        ),
      }),
      createSessionsPage({
        loadSessions: new LoadSessions(
          new DemoSessionDirectory(origin),
          new DemoProcessProbe(),
          clock,
          DEFAULT_ATTENTION_CONFIG,
        ),
      }),
      createExamplePage({ clock, requiredConnections: CONNECTIONS_FOR_EXAMPLE }),
    ],
  });
}
