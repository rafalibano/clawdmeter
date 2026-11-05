import { createApplication, type Application } from './application/application';
import type { ConnectionId } from './domain/connections';
import { DemoCalendar, createDemoConnectionAdapters, createDemoWorld } from './infrastructure/demo';
import { JsonSettingsStore, LocalStorageJsonFile } from './infrastructure/persistence';
import { SystemClock } from './infrastructure/platform/system-clock';
import { createExamplePage } from './ui/pages/example/example.page';
import { createTeamsPage } from './ui/pages/teams/teams.page';

const CONNECTIONS_FOR_EXAMPLE: ConnectionId[] = ['claude', 'github', 'microsoft', 'notifications'];

export function createComposition(): Application {
  const clock = new SystemClock();
  const world = createDemoWorld(window.location.search);
  const application: Application = createApplication({
    clock,
    settingsStore: new JsonSettingsStore(new LocalStorageJsonFile('dev-pulse.settings')),
    connectionAdapters: createDemoConnectionAdapters(world),
    pages: [
      createExamplePage({ clock, requiredConnections: CONNECTIONS_FOR_EXAMPLE }),
      createTeamsPage({
        clock,
        calendar: new DemoCalendar(world, clock),
        reporter: { execute: (id, problem, message) => application.connections.report.execute(id, problem, message) },
      }),
    ],
  });
  return application;
}
