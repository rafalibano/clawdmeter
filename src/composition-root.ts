import { createApplication, type Application } from './application/application';
import type { ConnectionAdapters } from './application/connections/connection-adapters';
import { GitHubTokenResolver } from './application/connections/github-token-resolver';
import { CurrentLanguage } from './application/language';
import { createPullRequests } from './application/pull-requests';
import { createSkills } from './application/skills';
import { ImportExternalUsageHistory, LoadSessions, LoadUsage } from './application/use-cases';
import { DEFAULT_ATTENTION_CONFIG } from './domain/sessions';
import { AnthropicUsageGateway } from './infrastructure/anthropic';
import { TauriSessionDirectory } from './infrastructure/claude-code';
import { TauriClaudeUsageBarHistorySource } from './infrastructure/claude-usage-bar';
import {
  GhCliTokenSource,
  GitHubDeviceFlowAuthorizer,
  GitHubGraphqlGateway,
  GitHubRestAccountGateway,
} from './infrastructure/github';
import { GraphCalendarGateway, PkceMicrosoftAuthorizer } from './infrastructure/microsoft';
import {
  JsonConnectionPrefsStore,
  JsonSettingsStore,
  JsonSkillRunStore,
  JsonSkillsConfigStore,
  JsonUsageHistoryStore,
} from './infrastructure/persistence';
import {
  SystemClock,
  TauriClaudeCredentialSource,
  TauriCommands,
  TauriJsonFile,
  TauriLaunchAtLogin,
  TauriNotificationPermission,
  TauriNotifier,
  TauriOAuthLoopback,
  TauriProcessProbe,
  TauriProcessRunner,
  TauriSecretStore,
  TauriStreamingProcessRunner,
  TauriSystemSettings,
  TauriTerminalLauncher,
  TauriUrlOpener,
  TauriUsageIndicator,
  tauriFetch,
} from './infrastructure/platform';
import { TauriUpdateChecker } from './infrastructure/updates';
import { LiveTranslator } from './ui/i18n/live-translator';
import { createPullRequestsPage } from './ui/pages/pull-requests/pull-requests.page';
import { createReviewsPage } from './ui/pages/reviews/reviews.page';
import { createSessionsPage } from './ui/pages/sessions/sessions.page';
import { createSkillsPage } from './ui/pages/skills/skills.page';
import { createTeamsPage } from './ui/pages/teams/teams.page';
import { createUsagePage } from './ui/pages/usage/usage.page';


export function createComposition(): Application {
  const clock = new SystemClock();
  const language = new CurrentLanguage();
  const translator = new LiveTranslator(language);
  const commands = new TauriCommands();
  const secrets = new TauriSecretStore(commands);
  const urls = new TauriUrlOpener(commands);
  const claudeCredentials = new TauriClaudeCredentialSource(commands);

  const microsoft = new PkceMicrosoftAuthorizer({
    fetcher: tauriFetch,
    loopback: new TauriOAuthLoopback(commands),
    urls,
    secrets,
    now: () => clock.now(),
  });

  const connectionAdapters: ConnectionAdapters = {
    prefs: new JsonConnectionPrefsStore(new TauriJsonFile('connections.json')),
    secrets,
    claudeCredentials,
    githubCli: new GhCliTokenSource(new TauriProcessRunner(commands)),
    githubDeviceFlow: new GitHubDeviceFlowAuthorizer(tauriFetch),
    githubAccounts: new GitHubRestAccountGateway(tauriFetch),
    microsoft,
    notifications: new TauriNotificationPermission(commands),
    systemSettings: new TauriSystemSettings(commands),
    urlOpener: urls,
    terminal: new TauriTerminalLauncher(commands),
  };

  const pullRequests = createPullRequests(
    {
      prefs: connectionAdapters.prefs,
      tokens: new GitHubTokenResolver(connectionAdapters.githubCli, secrets),
      gateway: new GitHubGraphqlGateway(tauriFetch),
    },
    clock,
  );

  const application: Application = createApplication({
    clock,
    language,
    settingsStore: new JsonSettingsStore(new TauriJsonFile('settings.json')),
    connectionAdapters,
    updateChecker: new TauriUpdateChecker(commands),
    launchAtLogin: new TauriLaunchAtLogin(),
    skills: ({ connections }) =>
      createSkills(
        {
          config: new JsonSkillsConfigStore(new TauriJsonFile('skills.json')),
          runs: new JsonSkillRunStore(new TauriJsonFile('runs.json')),
          runner: new TauriStreamingProcessRunner(commands),
          terminal: connectionAdapters.terminal,
          urls,
          notifier: new TauriNotifier(),
          translator,
        },
        clock,
        connections,
      ),
    pages: ({ connections, skills }) => [
      createUsagePage({
        loadUsage: new LoadUsage(
          connectionAdapters.prefs,
          new AnthropicUsageGateway(commands),
          new JsonUsageHistoryStore(new TauriJsonFile('usage-history.json')),
          clock,
          connections,
          new TauriUsageIndicator(commands, translator),
          new ImportExternalUsageHistory(new TauriClaudeUsageBarHistorySource()),
        ),
      }),
      createSessionsPage({
        loadSessions: new LoadSessions(
          new TauriSessionDirectory(),
          new TauriProcessProbe(commands),
          clock,
          DEFAULT_ATTENTION_CONFIG,
        ),
      }),
      createPullRequestsPage({ pullRequests }),
      createReviewsPage({ pullRequests }),
      createTeamsPage({
        clock,
        calendar: new GraphCalendarGateway({ fetcher: tauriFetch, authorizer: microsoft }),
        reporter: { execute: (id, problem, message) => application.connections.report.execute(id, problem, message) },
      }),
      createSkillsPage({ skills }),
    ],
  });
  return application;
}
