import type { ConnectionAdapters } from '../../application/connections/connection-adapters';
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
} from '../../application/ports';
import {
  CLAUDE_CODE_INSTALL_URL,
  ConnectionProblemError,
  GITHUB_ORG_SSO_URL,
  type ConnectionId,
  type ConnectionPrefs,
  type GitHubAccount,
} from '../../domain/connections';
import type { DemoWorld } from './demo-world';

const DEMO_LATENCY_MS = 350;
const DEMO_DEVICE_APPROVAL_MS = 2500;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function failOnce(world: DemoWorld, id: ConnectionId): void {
  if (world.failOnce.delete(id)) throw new Error('Sem rede (cenário demo)');
}

class DemoPrefsStore implements ConnectionPrefsStore {
  constructor(private readonly world: DemoWorld) {}

  async load(): Promise<ConnectionPrefs> {
    return this.world.prefs;
  }

  async save(prefs: ConnectionPrefs): Promise<void> {
    this.world.prefs = prefs;
  }
}

class DemoSecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

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

class DemoClaudeCredentials implements ClaudeCredentialSource {
  constructor(private readonly world: DemoWorld) {}

  async read(): Promise<ClaudeCredential> {
    await pause(DEMO_LATENCY_MS);
    failOnce(this.world, 'claude');
    const { claude } = this.world;
    if (claude.keychainDenied) {
      claude.keychainDenied = false;
      throw new ConnectionProblemError('keychain-denied');
    }
    if (claude.missing) throw new ConnectionProblemError('claude-code-missing');
    return { accessToken: 'demo', expiresAt: claude.expired ? 0 : null, subscriptionType: 'max' };
  }
}

class DemoGitHubCli implements GitHubCliTokenSource {
  constructor(private readonly world: DemoWorld) {}

  async token(): Promise<string | null> {
    await pause(DEMO_LATENCY_MS);
    return this.world.github.ghLoggedIn ? 'demo-gh-token' : null;
  }
}

class DemoGitHubDeviceFlow implements GitHubDeviceFlow {
  async start(): Promise<DeviceCode> {
    return {
      deviceCode: 'demo-device',
      userCode: 'DEMO-1234',
      verificationUri: 'https://github.com/login/device',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    };
  }

  async complete(): Promise<string> {
    await pause(DEMO_DEVICE_APPROVAL_MS);
    return 'ghp_demo_device_token';
  }
}

class DemoGitHubAccounts implements GitHubAccountGateway {
  constructor(private readonly world: DemoWorld) {}

  async inspect(token: string): Promise<GitHubAccount> {
    await pause(DEMO_LATENCY_MS);
    failOnce(this.world, 'github');
    const { github } = this.world;
    if (github.unauthorized || !token.startsWith('demo-gh-token') && !token.startsWith('ghp_')) {
      throw new ConnectionProblemError('github-unauthorized');
    }
    return {
      login: 'dev-mottu',
      scopes: github.missingScope ? ['gist'] : ['repo', 'read:org'],
      orgAccess: github.orgAccess,
    };
  }
}

class DemoMicrosoft implements MicrosoftAuthorizer {
  constructor(private readonly world: DemoWorld) {}

  async signIn(): Promise<MicrosoftSession> {
    await pause(DEMO_DEVICE_APPROVAL_MS);
    this.world.microsoft.expired = false;
    return { account: 'dev@mottu.com.br' };
  }

  async accessToken(): Promise<string> {
    await pause(DEMO_LATENCY_MS);
    failOnce(this.world, 'microsoft');
    if (this.world.microsoft.expired) throw new ConnectionProblemError('microsoft-expired');
    return 'demo-graph-token';
  }

  async signOut(): Promise<void> {
    this.world.microsoft.expired = false;
  }
}

class DemoNotifications implements NotificationPermission {
  constructor(private readonly world: DemoWorld) {}

  async status(): Promise<NotificationPermissionState> {
    failOnce(this.world, 'notifications');
    return this.world.notifications;
  }

  async request(): Promise<NotificationPermissionState> {
    if (this.world.notifications === 'prompt') this.world.notifications = 'granted';
    return this.world.notifications;
  }
}

class DemoSystemSettings implements SystemSettings {
  constructor(private readonly world: DemoWorld) {}

  async openNotifications(): Promise<void> {
    this.world.notifications = 'granted';
  }
}

class DemoUrlOpener implements UrlOpener {
  constructor(private readonly world: DemoWorld) {}

  async open(url: string): Promise<void> {
    if (url === CLAUDE_CODE_INSTALL_URL) this.world.claude.missing = false;
    if (url === GITHUB_ORG_SSO_URL) this.world.github.orgAccess = 'ok';
  }
}

class DemoTerminal implements TerminalLauncher {
  constructor(private readonly world: DemoWorld) {}

  async run(command: TerminalCommand): Promise<void> {
    const line = command.args.join(' ');
    if (command.program === 'claude' && line === '/login') this.world.claude.expired = false;
    if (command.program === 'gh' && line.startsWith('auth login')) this.world.github.unauthorized = false;
    if (command.program === 'gh' && line.startsWith('auth refresh')) this.world.github.missingScope = false;
  }
}

export function createDemoConnectionAdapters(world: DemoWorld): ConnectionAdapters {
  return {
    prefs: new DemoPrefsStore(world),
    secrets: new DemoSecretStore(),
    claudeCredentials: new DemoClaudeCredentials(world),
    githubCli: new DemoGitHubCli(world),
    githubDeviceFlow: new DemoGitHubDeviceFlow(),
    githubAccounts: new DemoGitHubAccounts(world),
    microsoft: new DemoMicrosoft(world),
    notifications: new DemoNotifications(world),
    systemSettings: new DemoSystemSettings(world),
    urlOpener: new DemoUrlOpener(world),
    terminal: new DemoTerminal(world),
  };
}
