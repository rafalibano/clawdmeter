import type { ConnectionId } from '../../domain/connections';
import type { Clock } from '../ports';
import {
  CheckClaudeConnection,
  CheckConnection,
  CheckConnections,
  CheckGitHubConnection,
  CheckMicrosoftConnection,
  CheckNotifications,
  CompleteGitHubDeviceFlow,
  ConnectClaude,
  ConnectConnection,
  ConnectGitHub,
  ConnectGitHubWithPat,
  ConnectMicrosoft,
  ConnectNotifications,
  DisconnectClaude,
  DisconnectConnection,
  DisconnectGitHub,
  DisconnectMicrosoft,
  FixClaudeConnection,
  FixConnection,
  FixGitHubConnection,
  FixMicrosoftConnection,
  FixNotifications,
  OpenUrl,
  ReportConnectionProblem,
  StartGitHubDeviceFlow,
} from '../use-cases/connections';
import type { ConnectionAdapters } from './connection-adapters';
import { ConnectionMonitor } from './connection-monitor';
import { ConnectionRunner, type StatusUseCase } from './connection-runner';
import { GitHubTokenResolver } from './github-token-resolver';

export interface Connections {
  monitor: ConnectionMonitor;
  check: CheckConnection;
  checkMany: CheckConnections;
  connect: ConnectConnection;
  disconnect: DisconnectConnection;
  fix: FixConnection;
  report: ReportConnectionProblem;
  openUrl: OpenUrl;
  github: {
    startDeviceFlow: StartGitHubDeviceFlow;
    completeDeviceFlow: CompleteGitHubDeviceFlow;
    connectWithPat: ConnectGitHubWithPat;
  };
}

export function createConnections(adapters: ConnectionAdapters, clock: Clock): Connections {
  const monitor = new ConnectionMonitor();
  const runner = new ConnectionRunner(monitor);
  const tokens = new GitHubTokenResolver(adapters.githubCli, adapters.secrets);

  const checkClaude = new CheckClaudeConnection(adapters.prefs, adapters.claudeCredentials, clock);
  const checkGitHub = new CheckGitHubConnection(adapters.prefs, tokens, adapters.githubAccounts);
  const checkMicrosoft = new CheckMicrosoftConnection(adapters.prefs, adapters.microsoft);
  const checkNotifications = new CheckNotifications(adapters.notifications);

  const connectMicrosoft = new ConnectMicrosoft(adapters.prefs, adapters.microsoft);
  const disconnectGitHub = new DisconnectGitHub(adapters.secrets, adapters.prefs);

  const checks: Record<ConnectionId, StatusUseCase> = {
    claude: checkClaude,
    github: checkGitHub,
    microsoft: checkMicrosoft,
    notifications: checkNotifications,
  };
  const check = new CheckConnection(checks, runner);

  return {
    monitor,
    check,
    checkMany: new CheckConnections(check),
    connect: new ConnectConnection(
      {
        claude: new ConnectClaude(adapters.prefs, checkClaude),
        github: new ConnectGitHub(adapters.prefs, adapters.githubCli, adapters.githubAccounts),
        microsoft: connectMicrosoft,
        notifications: new ConnectNotifications(adapters.notifications),
      },
      runner,
    ),
    disconnect: new DisconnectConnection(
      {
        claude: new DisconnectClaude(adapters.prefs),
        github: disconnectGitHub,
        microsoft: new DisconnectMicrosoft(adapters.prefs, adapters.microsoft),
      },
      runner,
    ),
    fix: new FixConnection(
      {
        claude: new FixClaudeConnection(checkClaude, adapters.terminal, adapters.urlOpener),
        github: new FixGitHubConnection(adapters.prefs, checkGitHub, disconnectGitHub, adapters.terminal, adapters.urlOpener),
        microsoft: new FixMicrosoftConnection(checkMicrosoft, connectMicrosoft),
        notifications: new FixNotifications(checkNotifications, adapters.systemSettings),
      },
      runner,
    ),
    report: new ReportConnectionProblem(monitor),
    openUrl: new OpenUrl(adapters.urlOpener),
    github: {
      startDeviceFlow: new StartGitHubDeviceFlow(adapters.githubDeviceFlow),
      completeDeviceFlow: new CompleteGitHubDeviceFlow(
        adapters.githubDeviceFlow,
        adapters.secrets,
        adapters.prefs,
        adapters.githubAccounts,
        runner,
      ),
      connectWithPat: new ConnectGitHubWithPat(adapters.secrets, adapters.prefs, adapters.githubAccounts, runner),
    },
  };
}
