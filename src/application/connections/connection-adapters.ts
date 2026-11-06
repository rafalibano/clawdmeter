import type {
  ClaudeAccountGateway,
  ConnectionPrefsStore,
  GitHubAccountGateway,
  GitHubCliTokenSource,
  GitHubDeviceFlow,
  MicrosoftAuthorizer,
  NotificationPermission,
  SecretStore,
  SystemSettings,
  TerminalLauncher,
  UrlOpener,
} from '../ports';

export interface ConnectionAdapters {
  prefs: ConnectionPrefsStore;
  secrets: SecretStore;
  claudeAccounts: ClaudeAccountGateway;
  githubCli: GitHubCliTokenSource;
  githubDeviceFlow: GitHubDeviceFlow;
  githubAccounts: GitHubAccountGateway;
  microsoft: MicrosoftAuthorizer;
  notifications: NotificationPermission;
  systemSettings: SystemSettings;
  urlOpener: UrlOpener;
  terminal: TerminalLauncher;
}
