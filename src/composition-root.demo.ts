import { createApplication, type Application } from './application/application';
import { GitHubTokenResolver } from './application/connections/github-token-resolver';
import { createPullRequests } from './application/pull-requests';
import type { ConnectionId } from './domain/connections';
import {
  DemoPullRequestGateway,
  createDemoConnectionAdapters,
  createDemoWorld,
} from './infrastructure/demo';
import { JsonSettingsStore, LocalStorageJsonFile } from './infrastructure/persistence';
import { SystemClock } from './infrastructure/platform/system-clock';
import { createExamplePage } from './ui/pages/example/example.page';
import { createPullRequestsPage } from './ui/pages/pull-requests/pull-requests.page';
import { createReviewsPage } from './ui/pages/reviews/reviews.page';

const CONNECTIONS_FOR_EXAMPLE: ConnectionId[] = ['claude', 'github', 'microsoft', 'notifications'];

export function createComposition(): Application {
  const clock = new SystemClock();
  const world = createDemoWorld(window.location.search);
  const connectionAdapters = createDemoConnectionAdapters(world);
  const pullRequests = createPullRequests(
    {
      prefs: connectionAdapters.prefs,
      tokens: new GitHubTokenResolver(connectionAdapters.githubCli, connectionAdapters.secrets),
      gateway: new DemoPullRequestGateway(world),
    },
    clock,
  );
  return createApplication({
    clock,
    settingsStore: new JsonSettingsStore(new LocalStorageJsonFile('dev-pulse.settings')),
    connectionAdapters,
    pages: [
      createExamplePage({ clock, requiredConnections: CONNECTIONS_FOR_EXAMPLE }),
      createPullRequestsPage({ pullRequests }),
      createReviewsPage({ pullRequests }),
    ],
  });
}
