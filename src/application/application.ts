import { createClaudeAccounts, type ClaudeAccounts } from './claude-accounts';
import type { ConnectionAdapters } from './connections/connection-adapters';
import { createConnections, type Connections } from './connections/create-connections';
import { GitHubTokenResolver } from './connections/github-token-resolver';
import { DailyUsageHistory } from './daily-usage';
import type { PageModule } from './pages/page-module';
import { PageRegistry } from './pages/page-registry';
import { CurrentLanguage } from './language';
import type { Clock, LaunchAtLogin, SettingsStore, UpdateChecker, UsageHistoryStores } from './ports';
import { GitHubSession } from './pull-requests/github-session';
import { PollingScheduler } from './scheduler/polling-scheduler';
import type { Skills } from './skills';
import {
  GetLaunchAtLogin,
  GetSettings,
  GetSettingsStatus,
  SetLaunchAtLogin,
  UpdateSettings,
  WatchSettings,
} from './use-cases';
import { JoinMeeting } from './use-cases/calendar';
import { OpenGitHubUrl } from './use-cases/pull-requests';
import type { LoadDailyUsage } from './use-cases/usage';
import { Updates } from './updates';

export interface Application {
  clock: Clock;
  registry: PageRegistry;
  scheduler: PollingScheduler;
  connections: Connections;
  claudeAccounts: ClaudeAccounts;
  joinMeeting: JoinMeeting;
  openGitHubUrl: OpenGitHubUrl;
  skills: Skills;
  updates: Updates;
  dailyUsage: DailyUsageHistory;
  language: CurrentLanguage;
  getSettings: GetSettings;
  getSettingsStatus: GetSettingsStatus;
  updateSettings: UpdateSettings;
  watchSettings: WatchSettings;
  getLaunchAtLogin: GetLaunchAtLogin;
  setLaunchAtLogin: SetLaunchAtLogin;
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
  connectionAdapters: ConnectionAdapters;
  usageHistories: UsageHistoryStores;
  loadDailyUsage?: LoadDailyUsage;
  newAccountId?: () => string;
  updateChecker: UpdateChecker;
  launchAtLogin: LaunchAtLogin;
  skills: Skills | ((context: SkillsContext) => Skills);
  pages: readonly PageModule[] | ((context: PageContext) => readonly PageModule[]);
}

function randomAccountId(): string {
  return globalThis.crypto.randomUUID();
}

export function createApplication(deps: ApplicationDeps): Application {
  const connections = createConnections(deps.connectionAdapters, deps.settingsStore);
  const updateSettings = new UpdateSettings(deps.settingsStore);
  const skills = typeof deps.skills === 'function' ? deps.skills({ connections }) : deps.skills;
  const registry = new PageRegistry(typeof deps.pages === 'function' ? deps.pages({ connections, skills }) : deps.pages);
  const adapters = deps.connectionAdapters;
  const github = new GitHubSession(adapters.prefs, new GitHubTokenResolver(adapters.githubCli, adapters.secrets));
  return {
    clock: deps.clock,
    registry,
    scheduler: new PollingScheduler(registry, deps.clock),
    connections,
    claudeAccounts: createClaudeAccounts({
      settings: deps.settingsStore,
      updateSettings,
      gateway: adapters.claudeAccounts,
      urls: adapters.urlOpener,
      histories: deps.usageHistories,
      clock: deps.clock,
      newId: deps.newAccountId ?? randomAccountId,
    }),
    joinMeeting: new JoinMeeting(deps.connectionAdapters.urlOpener),
    openGitHubUrl: new OpenGitHubUrl(deps.connectionAdapters.urlOpener),
    skills,
    updates: new Updates(deps.updateChecker, github, deps.clock),
    dailyUsage: new DailyUsageHistory(deps.loadDailyUsage, deps.clock),
    language: deps.language ?? new CurrentLanguage(),
    getSettings: new GetSettings(deps.settingsStore),
    getSettingsStatus: new GetSettingsStatus(deps.settingsStore),
    updateSettings,
    watchSettings: new WatchSettings(deps.settingsStore),
    getLaunchAtLogin: new GetLaunchAtLogin(deps.launchAtLogin),
    setLaunchAtLogin: new SetLaunchAtLogin(deps.launchAtLogin),
  };
}
