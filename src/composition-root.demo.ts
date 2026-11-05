import { createApplication, type Application } from './application/application';
import { GitHubTokenResolver } from './application/connections/github-token-resolver';
import { createPullRequests } from './application/pull-requests';
import { createSkills } from './application/skills';
import { LoadSessions, LoadUsage } from './application/use-cases';
import type { ConnectionId } from './domain/connections';
import { DEFAULT_ATTENTION_CONFIG } from './domain/sessions';
import {
  DemoCalendar,
  DemoNotifier,
  DemoProcessProbe,
  DemoPullRequestGateway,
  DemoSessionDirectory,
  DemoUsageGateway,
  DemoUsageHistoryStore,
  DemoUsageModel,
  createDemoConnectionAdapters,
  createDemoSkillAdapters,
  createDemoWorld,
} from './infrastructure/demo';
import { JsonSettingsStore, LocalStorageJsonFile } from './infrastructure/persistence';
import { SystemClock } from './infrastructure/platform/system-clock';
import { createExamplePage } from './ui/pages/example/example.page';
import { createPullRequestsPage } from './ui/pages/pull-requests/pull-requests.page';
import { createReviewsPage } from './ui/pages/reviews/reviews.page';
import { createSessionsPage } from './ui/pages/sessions/sessions.page';
import { createSkillsPage } from './ui/pages/skills/skills.page';
import { createTeamsPage } from './ui/pages/teams/teams.page';
import { createUsagePage } from './ui/pages/usage/usage.page';

const CONNECTIONS_FOR_EXAMPLE: ConnectionId[] = ['claude', 'github', 'microsoft', 'notifications'];

export function createComposition(): Application {
  const clock = new SystemClock();
  const world = createDemoWorld(window.location.search);
  const connectionAdapters = createDemoConnectionAdapters(world);
  const origin = clock.now();
  const usageModel = new DemoUsageModel(origin);
  const pullRequests = createPullRequests(
    {
      prefs: connectionAdapters.prefs,
      tokens: new GitHubTokenResolver(connectionAdapters.githubCli, connectionAdapters.secrets),
      gateway: new DemoPullRequestGateway(world),
    },
    clock,
  );
  const application: Application = createApplication({
    clock,
    settingsStore: new JsonSettingsStore(new LocalStorageJsonFile('dev-pulse.settings')),
    connectionAdapters,
    skills: ({ connections }) =>
      createSkills(
        createDemoSkillAdapters(world, {
          terminal: connectionAdapters.terminal,
          urls: connectionAdapters.urlOpener,
          notifier: new DemoNotifier(),
        }),
        clock,
        connections,
      ),
    pages: ({ connections, skills }) => [
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
      createPullRequestsPage({ pullRequests }),
      createReviewsPage({ pullRequests }),
      createTeamsPage({
        clock,
        calendar: new DemoCalendar(world, clock),
        reporter: { execute: (id, problem, message) => application.connections.report.execute(id, problem, message) },
      }),
      createSkillsPage({ skills }),
      createExamplePage({ clock, requiredConnections: CONNECTIONS_FOR_EXAMPLE }),
    ],
  });
  return application;
}
