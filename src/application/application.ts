import type { ConnectionAdapters } from './connections/connection-adapters';
import { createConnections, type Connections } from './connections/create-connections';
import type { PageModule } from './pages/page-module';
import { PageRegistry } from './pages/page-registry';
import type { Clock, SettingsStore } from './ports';
import { PollingScheduler } from './scheduler/polling-scheduler';
import { GetSettings, GetSettingsStatus, UpdateSettings, WatchSettings } from './use-cases';

export interface Application {
  clock: Clock;
  registry: PageRegistry;
  scheduler: PollingScheduler;
  connections: Connections;
  getSettings: GetSettings;
  getSettingsStatus: GetSettingsStatus;
  updateSettings: UpdateSettings;
  watchSettings: WatchSettings;
}

export interface ApplicationDeps {
  clock: Clock;
  settingsStore: SettingsStore;
  connectionAdapters: ConnectionAdapters;
  pages: readonly PageModule[];
}

export function createApplication(deps: ApplicationDeps): Application {
  const registry = new PageRegistry(deps.pages);
  return {
    clock: deps.clock,
    registry,
    scheduler: new PollingScheduler(registry, deps.clock),
    connections: createConnections(deps.connectionAdapters, deps.clock),
    getSettings: new GetSettings(deps.settingsStore),
    getSettingsStatus: new GetSettingsStatus(deps.settingsStore),
    updateSettings: new UpdateSettings(deps.settingsStore),
    watchSettings: new WatchSettings(deps.settingsStore),
  };
}
