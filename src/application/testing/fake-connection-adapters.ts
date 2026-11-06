import {
  createDefaultConnectionPrefs,
  type ConnectionPrefs,
  type GitHubAccount,
  type GitHubCliMissing,
} from '../../domain/connections';
import { CodedError } from '../../domain/coded-error';
import { createDefaultSettings, type AppSettings, type ClaudeAccount } from '../../domain/settings';
import type { ConnectionAdapters } from '../connections/connection-adapters';
import type {
  ClaudeAccountGateway,
  ClaudeAccountStatus,
  ClaudeLoginRequest,
  ClaudeLoginResult,
  ClaudeLoginStart,
  ConnectionPrefsStore,
  DeviceCode,
  GitHubAccountGateway,
  GitHubCliToken,
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
import { FakeSettingsStore } from './fake-settings-store';

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

export const FAKE_ACCOUNT: ClaudeAccount = { id: 'account-1', name: 'Personal' };

export const SIGNED_IN: ClaudeAccountStatus = { signedIn: true, expiresAt: 1_800_000_000_000 + 8 * 3_600_000, needsLogin: false };

interface WaitingLogin {
  request: ClaudeLoginRequest;
  resolve: (result: ClaudeLoginResult) => void;
  reject: (error: Error) => void;
}

export class FakeClaudeAccountGateway implements ClaudeAccountGateway {
  readonly begun: string[] = [];
  readonly completions: ClaudeLoginRequest[] = [];
  readonly cancelled: string[] = [];
  readonly removed: string[] = [];
  readonly statuses = new Map<string, ClaudeAccountStatus | Error>();
  beginOutcome: ClaudeLoginStart | Error = {
    loginId: 'login-1',
    authorizeUrl: 'https://claude.ai/oauth/authorize?state=state-1',
    state: 'state-1',
    redirectUri: 'http://localhost:54545/callback',
    manualAuthorizeUrl: 'https://claude.ai/oauth/authorize?state=state-1&manual=1',
  };
  browser: 'approve' | 'wait' | Error = 'approve';
  pasted: ClaudeLoginResult | Error = { expiresAt: SIGNED_IN.expiresAt, email: 'dev@example.com' };
  removeOutcome: Error | null = null;
  private readonly waiting = new Map<string, WaitingLogin>();

  async begin(clientId: string): Promise<ClaudeLoginStart> {
    this.begun.push(clientId);
    return resolve(this.beginOutcome);
  }

  async complete(request: ClaudeLoginRequest): Promise<ClaudeLoginResult> {
    this.completions.push(request);
    if (request.code !== undefined) {
      if (this.pasted instanceof CodedError && this.pasted.code === 'claude-login-code-invalid') throw this.pasted;
      this.fail(new CodedError('claude-login-cancelled'), request.loginId);
      return this.signIn(request.accountId, resolve(this.pasted));
    }
    if (this.browser instanceof Error) throw this.browser;
    const result = { expiresAt: SIGNED_IN.expiresAt, email: 'dev@example.com' };
    if (this.browser === 'approve') return this.signIn(request.accountId, result);
    return new Promise<ClaudeLoginResult>((done, reject) => {
      this.waiting.set(request.loginId, { request, resolve: () => done(this.signIn(request.accountId, result)), reject });
    });
  }

  async cancel(loginId: string): Promise<void> {
    this.cancelled.push(loginId);
    const waiting = this.waiting.get(loginId);
    this.waiting.delete(loginId);
    waiting?.reject(new CodedError('claude-login-cancelled'));
  }

  async status(accountId: string): Promise<ClaudeAccountStatus> {
    return resolve(this.statuses.get(accountId) ?? { signedIn: false, expiresAt: null, needsLogin: true });
  }

  async remove(accountId: string): Promise<void> {
    if (this.removeOutcome) throw this.removeOutcome;
    this.removed.push(accountId);
    this.statuses.delete(accountId);
  }

  isWaiting(loginId = 'login-1'): boolean {
    return this.waiting.has(loginId);
  }

  approve(loginId = 'login-1'): void {
    const waiting = this.waiting.get(loginId);
    this.waiting.delete(loginId);
    waiting?.resolve({ expiresAt: SIGNED_IN.expiresAt, email: null });
  }

  fail(error: Error, loginId = 'login-1'): void {
    const waiting = this.waiting.get(loginId);
    this.waiting.delete(loginId);
    waiting?.reject(error);
  }

  private signIn(accountId: string, result: ClaudeLoginResult): ClaudeLoginResult {
    this.statuses.set(accountId, { signedIn: true, expiresAt: result.expiresAt, needsLogin: false });
    return result;
  }
}

export function settingsWithAccounts(accounts: ClaudeAccount[], activeAccountId: string | null = accounts[0]?.id ?? null): AppSettings {
  const defaults = createDefaultSettings();
  return { ...defaults, claude: { ...defaults.claude, accounts, activeAccountId } };
}

export class FakeGitHubCli implements GitHubCliTokenSource {
  outcome: string | { missing: GitHubCliMissing } | Error = 'gh-token';

  async token(): Promise<GitHubCliToken> {
    const outcome = resolve(this.outcome);
    return typeof outcome === 'string' ? { token: outcome } : outcome;
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
  settings: FakeSettingsStore;
  claude: FakeClaudeAccountGateway;
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
  const settings = new FakeSettingsStore(settingsWithAccounts([FAKE_ACCOUNT]));
  const claude = new FakeClaudeAccountGateway();
  claude.statuses.set(FAKE_ACCOUNT.id, SIGNED_IN);
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
      claudeAccounts: claude,
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
    settings,
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
