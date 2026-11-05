import { createApplication, type Application } from './application/application';
import type { ConnectionAdapters } from './application/connections/connection-adapters';
import { GitHubTokenResolver } from './application/connections/github-token-resolver';
import { createPullRequests } from './application/pull-requests';
import type { ConnectionId } from './domain/connections';
import {
  GhCliTokenSource,
  GitHubDeviceFlowAuthorizer,
  GitHubGraphqlGateway,
  GitHubRestAccountGateway,
} from './infrastructure/github';
import { PkceMicrosoftAuthorizer } from './infrastructure/microsoft';
import {
  JsonConnectionPrefsStore,
  JsonSettingsStore,
} from './infrastructure/persistence';
import {
  SystemClock,
  TauriClaudeCredentialSource,
  TauriCommands,
  TauriJsonFile,
  TauriNotificationPermission,
  TauriOAuthLoopback,
  TauriProcessRunner,
  TauriSecretStore,
  TauriSystemSettings,
  TauriTerminalLauncher,
  TauriUrlOpener,
  tauriFetch,
} from './infrastructure/platform';
import { createExamplePage } from './ui/pages/example/example.page';
import { createPullRequestsPage } from './ui/pages/pull-requests/pull-requests.page';
import { createReviewsPage } from './ui/pages/reviews/reviews.page';

const CONNECTIONS_FOR_EXAMPLE: ConnectionId[] = ['claude', 'github', 'microsoft', 'notifications'];

export function createComposition(): Application {
  const clock = new SystemClock();
  const commands = new TauriCommands();
  const secrets = new TauriSecretStore(commands);
  const urls = new TauriUrlOpener(commands);

  const connectionAdapters: ConnectionAdapters = {
    prefs: new JsonConnectionPrefsStore(new TauriJsonFile('connections.json')),
    secrets,
    claudeCredentials: new TauriClaudeCredentialSource(commands),
    githubCli: new GhCliTokenSource(new TauriProcessRunner(commands)),
    githubDeviceFlow: new GitHubDeviceFlowAuthorizer(tauriFetch),
    githubAccounts: new GitHubRestAccountGateway(tauriFetch),
    microsoft: new PkceMicrosoftAuthorizer({
      fetcher: tauriFetch,
      loopback: new TauriOAuthLoopback(commands),
      urls,
      secrets,
      now: () => clock.now(),
    }),
    notifications: new TauriNotificationPermission(),
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
  return createApplication({
    clock,
    settingsStore: new JsonSettingsStore(new TauriJsonFile('settings.json')),
    connectionAdapters,
    pages: [
      createExamplePage({ clock, requiredConnections: CONNECTIONS_FOR_EXAMPLE }),
      createPullRequestsPage({ pullRequests }),
      createReviewsPage({ pullRequests }),
    ],
  });
}
