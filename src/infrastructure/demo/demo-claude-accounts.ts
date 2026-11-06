import type {
  ClaudeAccountGateway,
  ClaudeAccountStatus,
  ClaudeLoginRequest,
  ClaudeLoginResult,
  ClaudeLoginStart,
  SettingsFileStatus,
  SettingsStore,
  Unsubscribe,
} from '../../application/ports';
import { CodedError } from '../../domain/coded-error';
import { applyPatch, type AppSettings, type ClaudeAccount } from '../../domain/settings';
import { HOUR_MS } from '../../domain/time';
import type { DemoWorld } from './demo-world';

export const DEMO_ACCOUNTS: readonly ClaudeAccount[] = [
  { id: 'demo-personal', name: 'Personal' },
  { id: 'demo-work', name: 'Work' },
];

const DEMO_LATENCY_MS = 350;
const DEMO_BROWSER_APPROVAL_MS = 2500;
const DEMO_TOKEN_LIFETIME_MS = 8 * HOUR_MS;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface DemoLogin {
  timer: ReturnType<typeof setTimeout> | null;
  reject: ((error: Error) => void) | null;
}

export class DemoClaudeAccountGateway implements ClaudeAccountGateway {
  private readonly expired = new Set<string>();
  private readonly logins = new Map<string, DemoLogin>();
  private sequence = 0;

  constructor(
    private readonly world: DemoWorld,
    private readonly now: () => number = Date.now,
  ) {
    if (world.claude.signInRequired) this.expired.add(DEMO_ACCOUNTS[0]!.id);
  }

  requiresSignIn(accountId: string): boolean {
    return this.expired.has(accountId);
  }

  async begin(clientId: string): Promise<ClaudeLoginStart> {
    await pause(DEMO_LATENCY_MS);
    if (this.world.failOnce.delete('claude')) throw new CodedError('claude-login-failed');
    this.sequence += 1;
    const loginId = `demo-login-${this.sequence}`;
    this.logins.set(loginId, { timer: null, reject: null });
    return {
      loginId,
      authorizeUrl: `https://claude.ai/oauth/authorize?client_id=${encodeURIComponent(clientId)}&state=demo-${this.sequence}`,
      state: `demo-${this.sequence}`,
      redirectUri: 'http://localhost:54545/callback',
      manualAuthorizeUrl: `https://claude.ai/oauth/authorize?client_id=${encodeURIComponent(clientId)}&state=demo-${this.sequence}&manual=1`,
    };
  }

  async complete(request: ClaudeLoginRequest): Promise<ClaudeLoginResult> {
    const login = this.logins.get(request.loginId);
    if (login === undefined) throw new CodedError('claude-login-cancelled');
    if (request.code !== undefined) {
      login.reject?.(new CodedError('claude-login-cancelled'));
      login.reject = null;
      await pause(DEMO_LATENCY_MS);
      return this.signIn(request.loginId, request.accountId);
    }
    return new Promise<ClaudeLoginResult>((resolve, reject) => {
      login.reject = reject;
      login.timer = setTimeout(() => {
        login.reject = null;
        resolve(this.signIn(request.loginId, request.accountId));
      }, DEMO_BROWSER_APPROVAL_MS);
    });
  }

  async cancel(loginId: string): Promise<void> {
    const login = this.logins.get(loginId);
    this.logins.delete(loginId);
    if (login?.timer) clearTimeout(login.timer);
    login?.reject?.(new CodedError('claude-login-cancelled'));
  }

  async status(accountId: string): Promise<ClaudeAccountStatus> {
    await pause(DEMO_LATENCY_MS);
    if (this.world.failOnce.delete('claude')) throw new Error('No network (demo scenario)');
    const expired = this.expired.has(accountId);
    return { signedIn: !expired, expiresAt: expired ? null : this.now() + DEMO_TOKEN_LIFETIME_MS, needsLogin: expired };
  }

  async remove(accountId: string): Promise<void> {
    this.expired.delete(accountId);
  }

  private signIn(loginId: string, accountId: string): ClaudeLoginResult {
    const login = this.logins.get(loginId);
    if (login?.timer) clearTimeout(login.timer);
    this.logins.delete(loginId);
    this.expired.delete(accountId);
    return { expiresAt: this.now() + DEMO_TOKEN_LIFETIME_MS, email: null };
  }
}

export class DemoAccountsSettingsStore implements SettingsStore {
  private seeded = false;

  constructor(
    private readonly inner: SettingsStore,
    private readonly accounts: readonly ClaudeAccount[],
  ) {}

  async load(): Promise<AppSettings> {
    const settings = await this.inner.load();
    if (this.seeded || this.accounts.length === 0 || settings.claude.accounts.length > 0) {
      this.seeded = true;
      return settings;
    }
    this.seeded = true;
    const seeded = applyPatch(settings, { claude: { accounts: [...this.accounts], activeAccountId: this.accounts[0]!.id } });
    await this.inner.save(seeded).catch(() => undefined);
    return seeded;
  }

  save(settings: AppSettings): Promise<void> {
    return this.inner.save(settings);
  }

  watch(listener: (settings: AppSettings) => void): Promise<Unsubscribe> {
    return this.inner.watch(listener);
  }

  status(): SettingsFileStatus {
    return this.inner.status();
  }
}

export function demoAccountsFor(world: DemoWorld): readonly ClaudeAccount[] {
  return world.claude.noAccount ? [] : DEMO_ACCOUNTS;
}
