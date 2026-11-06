import { CodedError } from '../../../domain/coded-error';
import { effectiveClaudeClientId, isClaudeAccountId, type ClaudeAccount } from '../../../domain/settings';
import { CLAUDE_LOGIN_TIMEOUT_MS, checkedNewAccount, type ClaudeAccountDeps } from './claude-account-deps';

export type ClaudeLoginMode = 'add' | 'reauthenticate';

export type ClaudeLoginState = 'waiting' | 'succeeded' | 'cancelled' | 'failed';

export class PendingClaudeLogin {
  private current: ClaudeLoginState = 'waiting';
  private finishing: Promise<ClaudeAccount | null> | null = null;
  private pasting: Promise<boolean> | null = null;

  constructor(
    readonly loginId: string,
    readonly account: ClaudeAccount,
    readonly mode: ClaudeLoginMode,
    readonly manualAuthorizeUrl: string,
  ) {}

  status(): ClaudeLoginState {
    return this.current;
  }

  settle(state: Exclude<ClaudeLoginState, 'waiting'>): boolean {
    if (this.current !== 'waiting') return false;
    this.current = state;
    return true;
  }

  finishOnce(work: () => Promise<ClaudeAccount | null>): Promise<ClaudeAccount | null> {
    this.finishing ??= work();
    return this.finishing;
  }

  trackPaste(attempt: Promise<unknown>): void {
    this.pasting = attempt.then(
      () => true,
      () => false,
    );
  }

  pasteTried(): boolean {
    return this.pasting !== null;
  }

  pasted(): Promise<boolean> {
    return this.pasting ?? Promise.resolve(false);
  }
}

export type PendingLoginListener = (login: PendingClaudeLogin) => void;

function takenOverByPaste(error: unknown): boolean {
  return error instanceof CodedError && error.code === 'claude-login-cancelled';
}

export class ClaudeLogins {
  private readonly open = new Set<PendingClaudeLogin>();

  constructor(private readonly deps: ClaudeAccountDeps) {}

  newAccount(name: string, accounts: readonly ClaudeAccount[]): ClaudeAccount {
    const checked = checkedNewAccount(name, accounts);
    const id = this.deps.newId();
    if (!isClaudeAccountId(id) || accounts.some((account) => account.id === id)) throw new CodedError('claude-login-failed');
    return { id, name: checked };
  }

  async begin(account: ClaudeAccount, mode: ClaudeLoginMode, onPending?: PendingLoginListener): Promise<PendingClaudeLogin> {
    const { claude } = await this.deps.settings.load();
    const start = await this.deps.gateway.begin(effectiveClaudeClientId(claude));
    const login = new PendingClaudeLogin(start.loginId, account, mode, start.manualAuthorizeUrl);
    this.open.add(login);
    onPending?.(login);
    if (login.status() !== 'waiting') {
      await this.release(login);
      return login;
    }
    try {
      await this.deps.urls.open(start.authorizeUrl);
    } catch (error) {
      login.settle('failed');
      await this.release(login);
      throw error;
    }
    return login;
  }

  async waitForBrowser(login: PendingClaudeLogin): Promise<ClaudeAccount | null> {
    if (login.status() === 'cancelled') return null;
    try {
      await this.deps.gateway.complete({ loginId: login.loginId, accountId: login.account.id, timeoutMs: this.timeoutMs });
    } catch (error) {
      if (login.status() === 'succeeded' || (login.pasteTried() && (await login.pasted()))) return this.finish(login);
      const cancelled = !login.settle('failed') && login.status() === 'cancelled';
      await this.release(login);
      if (cancelled || (login.pasteTried() && takenOverByPaste(error))) return null;
      throw error;
    }
    return this.finish(login);
  }

  async openCodePage(login: PendingClaudeLogin): Promise<void> {
    if (login.status() !== 'waiting') throw new CodedError(login.status() === 'cancelled' ? 'claude-login-cancelled' : 'claude-login-failed');
    await this.deps.urls.open(login.manualAuthorizeUrl);
  }

  async withCode(login: PendingClaudeLogin, code: string): Promise<ClaudeAccount | null> {
    const pasted = code.trim();
    if (pasted === '') throw new CodedError('claude-login-code-empty');
    if (login.status() === 'succeeded') return this.finish(login);
    if (login.status() !== 'waiting') throw new CodedError(login.status() === 'cancelled' ? 'claude-login-cancelled' : 'claude-login-failed');
    const attempt = this.deps.gateway.complete({ loginId: login.loginId, accountId: login.account.id, code: pasted });
    login.trackPaste(attempt);
    try {
      await attempt;
    } catch (error) {
      if (login.status() === 'succeeded') return this.finish(login);
      throw error;
    }
    const account = await this.finish(login);
    await this.release(login);
    return account;
  }

  async cancel(login: PendingClaudeLogin): Promise<void> {
    if (!login.settle('cancelled')) return;
    await this.release(login);
  }

  async cancelFor(accountId: string): Promise<void> {
    const logins = [...this.open].filter((login) => login.account.id === accountId);
    await Promise.all(logins.map((login) => this.cancel(login)));
  }

  private get timeoutMs(): number {
    return this.deps.loginTimeoutMs ?? CLAUDE_LOGIN_TIMEOUT_MS;
  }

  private release(login: PendingClaudeLogin): Promise<void> {
    this.open.delete(login);
    return this.deps.gateway.cancel(login.loginId).catch(() => undefined);
  }

  private finish(login: PendingClaudeLogin): Promise<ClaudeAccount | null> {
    return login.finishOnce(() => this.conclude(login));
  }

  private async conclude(login: PendingClaudeLogin): Promise<ClaudeAccount | null> {
    this.open.delete(login);
    const settled = login.settle('succeeded');
    if (login.mode === 'reauthenticate') return this.concludeReauthentication(login, settled);
    if (!settled) {
      await this.deps.gateway.remove(login.account.id).catch(() => undefined);
      return null;
    }
    try {
      await this.record(login.account);
    } catch (error) {
      await this.deps.gateway.remove(login.account.id).catch(() => undefined);
      throw error;
    }
    return login.account;
  }

  private async concludeReauthentication(login: PendingClaudeLogin, settled: boolean): Promise<ClaudeAccount | null> {
    const { claude } = await this.deps.settings.load();
    if (claude.accounts.some((account) => account.id === login.account.id)) return settled ? login.account : null;
    await this.deps.gateway.remove(login.account.id).catch(() => undefined);
    return null;
  }

  private async record(account: ClaudeAccount): Promise<void> {
    const first = (await this.deps.settings.load()).claude.accounts.length === 0;
    let adopted = false;
    try {
      if (first) adopted = await this.deps.histories.adoptLegacy(account.id).catch(() => false);
      else await this.deps.histories.forAccount(account.id).markImported(this.deps.clock.now());
      await this.deps.updateSettings.execute((current) => {
        const { accounts, activeAccountId } = current.claude;
        if (accounts.some((existing) => existing.id === account.id)) return {};
        const name = checkedNewAccount(account.name, accounts);
        return { claude: { accounts: [...accounts, { id: account.id, name }], activeAccountId: first ? account.id : activeAccountId } };
      });
    } catch (error) {
      if (adopted) await this.deps.histories.releaseLegacy(account.id).catch(() => undefined);
      else await this.deps.histories.remove(account.id).catch(() => undefined);
      throw error;
    }
  }
}
