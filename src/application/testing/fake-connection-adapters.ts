import {
  createDefaultConnectionPrefs,
  type ConnectionPrefs,
  type GitHubAccount,
} from '../../domain/connections';
import type { ConnectionAdapters } from '../connections/connection-adapters';
import type {
  ClaudeCredential,
  ClaudeCredentialSource,
  ConnectionPrefsStore,
  DeviceCode,
  GitHubAccountGateway,
  GitHubCliTokenSource,
  GitHubDeviceFlow,
  MicrosoftAuthorizer,
  MicrosoftSession,
  NotificationPermission,
  NotificationPermissionState,
  SecretStore,
  SystemSettings,
  TerminalCommand,
  TerminalLauncher,
  UrlOpener,
} from '../ports';

function resolve<T>(outcome: T | Error): T {
  if (outcome instanceof Error) throw outcome;
  return outcome;
}

export class FakeConnectionPrefsStore implements ConnectionPrefsStore {
  saved: ConnectionPrefs[] = [];

  constructor(public current: ConnectionPrefs = createDefaultConnectionPrefs()) {}

  async load(): Promise<ConnectionPrefs> {
    return this.current;
  }

  async save(prefs: ConnectionPrefs): Promise<void> {
    this.current = prefs;
    this.saved.push(prefs);
  }
}

export class FakeSecretStore implements SecretStore {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

export class FakeClaudeCredentialSource implements ClaudeCredentialSource {
  outcome: ClaudeCredential | Error = { accessToken: 'token', expiresAt: null, subscriptionType: 'max' };
  reads = 0;

  async read(): Promise<ClaudeCredential> {
    this.reads += 1;
    return resolve(this.outcome);
  }
}

export class FakeGitHubCli implements GitHubCliTokenSource {
  outcome: string | null | Error = 'gh-token';

  async token(): Promise<string | null> {
    return resolve(this.outcome);
  }
}

export const DEVICE_CODE: DeviceCode = {
  deviceCode: 'dev-code',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  intervalSeconds: 5,
  expiresInSeconds: 900,
};

export class FakeGitHubDeviceFlow implements GitHubDeviceFlow {
  startOutcome: DeviceCode | Error = DEVICE_CODE;
  completion: string | Error = 'device-token';
  waitForAbort = false;

  async start(): Promise<DeviceCode> {
    return resolve(this.startOutcome);
  }

  complete(_code: DeviceCode, signal?: AbortSignal): Promise<string> {
    if (!this.waitForAbort) return Promise.resolve().then(() => resolve(this.completion));
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Login cancelado', 'AbortError')));
    });
  }
}

export class FakeGitHubAccounts implements GitHubAccountGateway {
  outcome: GitHubAccount | Error = { login: 'dev', scopes: ['repo', 'read:org'], orgAccess: 'ok' };
  readonly inspected: string[] = [];

  async inspect(token: string): Promise<GitHubAccount> {
    this.inspected.push(token);
    return resolve(this.outcome);
  }
}

export class FakeMicrosoft implements MicrosoftAuthorizer {
  signInOutcome: MicrosoftSession | Error = { account: 'dev@mottu.com.br' };
  tokenOutcome: string | Error = 'graph-token';
  signedIn = 0;
  signedOut = 0;

  async signIn(): Promise<MicrosoftSession> {
    this.signedIn += 1;
    return resolve(this.signInOutcome);
  }

  async accessToken(): Promise<string> {
    return resolve(this.tokenOutcome);
  }

  async signOut(): Promise<void> {
    this.signedOut += 1;
  }
}

export class FakeNotificationPermission implements NotificationPermission {
  state: NotificationPermissionState = 'granted';
  requestResult: NotificationPermissionState = 'granted';

  async status(): Promise<NotificationPermissionState> {
    return this.state;
  }

  async request(): Promise<NotificationPermissionState> {
    this.state = this.requestResult;
    return this.state;
  }
}

export class FakeSystemSettings implements SystemSettings {
  notificationsOpened = 0;

  async openNotifications(): Promise<void> {
    this.notificationsOpened += 1;
  }
}

export class FakeUrlOpener implements UrlOpener {
  readonly opened: string[] = [];

  async open(url: string): Promise<void> {
    this.opened.push(url);
  }
}

export class FakeTerminal implements TerminalLauncher {
  readonly commands: TerminalCommand[] = [];

  async run(command: TerminalCommand): Promise<void> {
    this.commands.push(command);
  }
}

export interface FakeConnectionWorld {
  adapters: ConnectionAdapters;
  prefs: FakeConnectionPrefsStore;
  secrets: FakeSecretStore;
  claude: FakeClaudeCredentialSource;
  githubCli: FakeGitHubCli;
  deviceFlow: FakeGitHubDeviceFlow;
  githubAccounts: FakeGitHubAccounts;
  microsoft: FakeMicrosoft;
  notifications: FakeNotificationPermission;
  systemSettings: FakeSystemSettings;
  urls: FakeUrlOpener;
  terminal: FakeTerminal;
}

export function createFakeConnectionWorld(): FakeConnectionWorld {
  const prefs = new FakeConnectionPrefsStore();
  const secrets = new FakeSecretStore();
  const claude = new FakeClaudeCredentialSource();
  const githubCli = new FakeGitHubCli();
  const deviceFlow = new FakeGitHubDeviceFlow();
  const githubAccounts = new FakeGitHubAccounts();
  const microsoft = new FakeMicrosoft();
  const notifications = new FakeNotificationPermission();
  const systemSettings = new FakeSystemSettings();
  const urls = new FakeUrlOpener();
  const terminal = new FakeTerminal();
  return {
    adapters: {
      prefs,
      secrets,
      claudeCredentials: claude,
      githubCli,
      githubDeviceFlow: deviceFlow,
      githubAccounts,
      microsoft,
      notifications,
      systemSettings,
      urlOpener: urls,
      terminal,
    },
    prefs,
    secrets,
    claude,
    githubCli,
    deviceFlow,
    githubAccounts,
    microsoft,
    notifications,
    systemSettings,
    urls,
    terminal,
  };
}
