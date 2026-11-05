import type { ConnectionAdapters } from './connections/connection-adapters';
import { createConnections, type Connections } from './connections/create-connections';
import type { PageModule } from './pages/page-module';
import { PageRegistry } from './pages/page-registry';
import type { Clock, SettingsStore } from './ports';
import { PollingScheduler } from './scheduler/polling-scheduler';
import type { Skills } from './skills';
import { GetSettings, GetSettingsStatus, UpdateSettings, WatchSettings } from './use-cases';
import { JoinMeeting } from './use-cases/calendar';

export interface Application {
  clock: Clock;
  registry: PageRegistry;
  scheduler: PollingScheduler;
  connections: Connections;
  joinMeeting: JoinMeeting;
  skills: Skills;
  getSettings: GetSettings;
  getSettingsStatus: GetSettingsStatus;
  updateSettings: UpdateSettings;
  watchSettings: WatchSettings;
}

export interface SkillsContext {
  connections: Connections;
}

export interface PageContext extends SkillsContext {
  skills: Skills;
}

export interface ApplicationDeps {
  clock: Clock;
  settingsStore: SettingsStore;
  connectionAdapters: ConnectionAdapters;
  skills: Skills | ((context: SkillsContext) => Skills);
  pages: readonly PageModule[] | ((context: PageContext) => readonly PageModule[]);
}

export function createApplication(deps: ApplicationDeps): Application {
  const connections = createConnections(deps.connectionAdapters, deps.clock);
  const skills = typeof deps.skills === 'function' ? deps.skills({ connections }) : deps.skills;
  const registry = new PageRegistry(typeof deps.pages === 'function' ? deps.pages({ connections, skills }) : deps.pages);
  return {
    clock: deps.clock,
    registry,
    scheduler: new PollingScheduler(registry, deps.clock),
    connections,
    joinMeeting: new JoinMeeting(deps.connectionAdapters.urlOpener),
    skills,
    getSettings: new GetSettings(deps.settingsStore),
    getSettingsStatus: new GetSettingsStatus(deps.settingsStore),
    updateSettings: new UpdateSettings(deps.settingsStore),
    watchSettings: new WatchSettings(deps.settingsStore),
  };
}
