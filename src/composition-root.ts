import { createApplication, type Application } from './application/application';
import type { ConnectionAdapters } from './application/connections/connection-adapters';
import type { ConnectionId } from './domain/connections';
import { GhCliTokenSource, GitHubDeviceFlowAuthorizer, GitHubRestAccountGateway } from './infrastructure/github';
import { PkceMicrosoftAuthorizer } from './infrastructure/microsoft';
import { JsonConnectionPrefsStore, JsonSettingsStore } from './infrastructure/persistence';
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

  return createApplication({
    clock,
    settingsStore: new JsonSettingsStore(new TauriJsonFile('settings.json')),
    connectionAdapters,
    pages: [createExamplePage({ clock, requiredConnections: CONNECTIONS_FOR_EXAMPLE })],
  });
}
