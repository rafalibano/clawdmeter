import type { ConnectionAdapters } from './connections/connection-adapters';
import { createConnections, type Connections } from './connections/create-connections';
import type { PageModule } from './pages/page-module';
import { PageRegistry } from './pages/page-registry';
import { CurrentLanguage } from './language';
import type { Clock, SettingsStore, StartupNotices } from './ports';
import { PollingScheduler } from './scheduler/polling-scheduler';
import type { Skills } from './skills';
import { GetSettings, GetSettingsStatus, LoadStartupNotice, UpdateSettings, WatchSettings } from './use-cases';
import { JoinMeeting } from './use-cases/calendar';
import { OpenGitHubUrl } from './use-cases/pull-requests';

export interface Application {
  clock: Clock;
  registry: PageRegistry;
  scheduler: PollingScheduler;
  connections: Connections;
  joinMeeting: JoinMeeting;
  openGitHubUrl: OpenGitHubUrl;
  skills: Skills;
  language: CurrentLanguage;
  getSettings: GetSettings;
  getSettingsStatus: GetSettingsStatus;
  updateSettings: UpdateSettings;
  watchSettings: WatchSettings;
  loadStartupNotice: LoadStartupNotice;
}

export interface SkillsContext {
  connections: Connections;
}

export interface PageContext extends SkillsContext {
  skills: Skills;
}

export interface ApplicationDeps {
  clock: Clock;
  language?: CurrentLanguage;
  settingsStore: SettingsStore;
  startupNotices?: StartupNotices;
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
    openGitHubUrl: new OpenGitHubUrl(deps.connectionAdapters.urlOpener),
    skills,
    language: deps.language ?? new CurrentLanguage(),
    getSettings: new GetSettings(deps.settingsStore),
    getSettingsStatus: new GetSettingsStatus(deps.settingsStore),
    updateSettings: new UpdateSettings(deps.settingsStore),
    watchSettings: new WatchSettings(deps.settingsStore),
    loadStartupNotice: new LoadStartupNotice(deps.startupNotices ?? { pending: async () => null }),
  };
}
