import { createApplication, type Application } from './application/application';
import type { ConnectionAdapters } from './application/connections/connection-adapters';
import { LoadSessions, LoadUsage } from './application/use-cases';
import type { ConnectionId } from './domain/connections';
import { DEFAULT_ATTENTION_CONFIG } from './domain/sessions';
import { AnthropicUsageGateway } from './infrastructure/anthropic';
import { TauriSessionDirectory } from './infrastructure/claude-code';
import { GhCliTokenSource, GitHubDeviceFlowAuthorizer, GitHubRestAccountGateway } from './infrastructure/github';
import { PkceMicrosoftAuthorizer } from './infrastructure/microsoft';
import { JsonConnectionPrefsStore, JsonSettingsStore, JsonUsageHistoryStore } from './infrastructure/persistence';
import {
  SystemClock,
  TauriClaudeCredentialSource,
  TauriCommands,
  TauriJsonFile,
  TauriNotificationPermission,
  TauriOAuthLoopback,
  TauriProcessProbe,
  TauriProcessRunner,
  TauriSecretStore,
  TauriSystemSettings,
  TauriTerminalLauncher,
  TauriUrlOpener,
  tauriFetch,
} from './infrastructure/platform';
import { createExamplePage } from './ui/pages/example/example.page';
import { createSessionsPage } from './ui/pages/sessions/sessions.page';
import { createUsagePage } from './ui/pages/usage/usage.page';

const CONNECTIONS_FOR_EXAMPLE: ConnectionId[] = ['claude', 'github', 'microsoft', 'notifications'];

export function createComposition(): Application {
  const clock = new SystemClock();
  const commands = new TauriCommands();
  const secrets = new TauriSecretStore(commands);
  const urls = new TauriUrlOpener(commands);
  const claudeCredentials = new TauriClaudeCredentialSource(commands);

  const connectionAdapters: ConnectionAdapters = {
    prefs: new JsonConnectionPrefsStore(new TauriJsonFile('connections.json')),
    secrets,
    claudeCredentials,
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

  return createApplication({
    clock,
    settingsStore: new JsonSettingsStore(new TauriJsonFile('settings.json')),
    connectionAdapters,
    pages: ({ connections }) => [
      createUsagePage({
        loadUsage: new LoadUsage(
          connectionAdapters.prefs,
          claudeCredentials,
          new AnthropicUsageGateway(tauriFetch),
          new JsonUsageHistoryStore(new TauriJsonFile('usage-history.json')),
          clock,
          connections,
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
      createExamplePage({ clock, requiredConnections: CONNECTIONS_FOR_EXAMPLE }),
    ],
  });
}
