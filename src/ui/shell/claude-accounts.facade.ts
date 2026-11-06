import { Injectable, computed, inject, signal } from '@angular/core';
import type { ClaudeAccountStatus } from '../../application/ports';
import type { ClaudeClientIdChoice, ClaudeLoginMode, PendingClaudeLogin } from '../../application/use-cases';
import { CodedError } from '../../domain/coded-error';
import type { ClaudeAccount } from '../../domain/settings';
import { USAGE_PAGE } from '../pages/usage/usage-page-ref';
import type { ClaudeLoginSuccess, ClaudeLoginView } from '../settings/claude-accounts/claude-accounts-view';
import { APPLICATION } from './application.token';
import { SettingsFacade } from './settings.facade';

type LoginPhase =
  | { kind: 'idle' }
  | { kind: 'starting'; mode: ClaudeLoginMode; cancelRequested: boolean }
  | { kind: 'waiting'; login: PendingClaudeLogin; pasting: boolean; submitting: boolean };

@Injectable({ providedIn: 'root' })
export class ClaudeAccountsFacade {
  private readonly app = inject(APPLICATION);
  private readonly settings = inject(SettingsFacade);
  private readonly phase = signal<LoginPhase>({ kind: 'idle' });
  private readonly statusMap = signal<ReadonlyMap<string, ClaudeAccountStatus | null>>(new Map());
  private readonly failureState = signal<unknown>(null);
  private readonly busyState = signal(false);
  private readonly successState = signal<ClaudeLoginSuccess | null>(null);
  private readonly concluded = new WeakSet<PendingClaudeLogin>();
  private activeBeforeSignIn: string | null = null;
  private running = 0;

  readonly claude = computed(() => this.settings.settings().claude);
  readonly statuses = this.statusMap.asReadonly();
  readonly failure = this.failureState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly success = this.successState.asReadonly();
  readonly loginBusy = computed(() => this.phase().kind !== 'idle');
  readonly login = computed<ClaudeLoginView | null>(() => {
    const phase = this.phase();
    if (phase.kind === 'idle') return null;
    if (phase.kind === 'starting') return { kind: 'starting' };
    return { kind: 'waiting', mode: phase.login.mode, name: phase.login.account.name, pasting: phase.pasting, submitting: phase.submitting };
  });

  async refreshStatuses(): Promise<void> {
    try {
      const listing = await this.app.claudeAccounts.list.execute();
      this.statusMap.set(new Map(listing.accounts.map((entry) => [entry.account.id, entry.status])));
    } catch {
      this.statusMap.set(new Map());
    }
  }

  add(name: string): Promise<boolean> {
    return this.signIn('add', (onPending) => this.app.claudeAccounts.add.execute(name, onPending));
  }

  reauthenticate(accountId: string): Promise<boolean> {
    return this.signIn('reauthenticate', (onPending) => this.app.claudeAccounts.reauthenticate.execute(accountId, onPending));
  }

  reauthenticateActive(): Promise<boolean> {
    const active = this.claude().activeAccountId;
    return active === null ? Promise.resolve(false) : this.reauthenticate(active);
  }

  async showCodeEntry(): Promise<void> {
    const phase = this.phase();
    if (phase.kind !== 'waiting' || phase.pasting) return;
    this.failureState.set(null);
    this.phase.set({ ...phase, pasting: true });
    await this.app.claudeAccounts.openCodePage.execute(phase.login).catch((error: unknown) => this.failureState.set(error));
  }

  async submitCode(code: string): Promise<void> {
    const phase = this.phase();
    if (phase.kind !== 'waiting' || phase.submitting) return;
    this.failureState.set(null);
    this.phase.set({ ...phase, submitting: true });
    try {
      const account = await this.app.claudeAccounts.completeWithCode.execute(phase.login, code);
      await this.conclude(phase.login, account);
    } catch (error) {
      this.failureState.set(error);
      const current = this.phase();
      if (current.kind === 'waiting' && current.login === phase.login) this.phase.set({ ...current, submitting: false });
    }
  }

  async cancelLogin(): Promise<void> {
    const phase = this.phase();
    if (phase.kind === 'starting') {
      this.phase.set({ ...phase, cancelRequested: true });
      return;
    }
    if (phase.kind !== 'waiting') return;
    await this.app.claudeAccounts.cancelLogin.execute(phase.login);
  }

  async rename(accountId: string, name: string): Promise<boolean> {
    return this.change(async () => {
      await this.app.claudeAccounts.rename.execute(accountId, name);
      await this.app.connections.check.execute('claude');
    });
  }

  async remove(accountId: string): Promise<boolean> {
    const phase = this.phase();
    if (phase.kind === 'starting' || (phase.kind === 'waiting' && phase.login.account.id === accountId)) {
      this.failureState.set(new CodedError('claude-login-busy'));
      return false;
    }
    const previous = this.claude().activeAccountId;
    return this.change(async () => {
      await this.app.claudeAccounts.remove.execute(accountId);
      await this.afterAccountsChanged(previous);
    });
  }

  async select(accountId: string): Promise<boolean> {
    const previous = this.claude().activeAccountId;
    if (previous === accountId) return true;
    return this.change(async () => {
      await this.app.claudeAccounts.select.execute(accountId);
      await this.afterAccountsChanged(previous);
    });
  }

  async setClientIdMode(choice: ClaudeClientIdChoice): Promise<boolean> {
    return this.change(async () => {
      await this.app.claudeAccounts.setClientIdMode.execute(choice);
    });
  }

  clearFailure(): void {
    this.failureState.set(null);
    this.successState.set(null);
  }

  private async signIn(
    mode: ClaudeLoginMode,
    start: (onPending: (login: PendingClaudeLogin) => void) => Promise<ClaudeAccount | null>,
  ): Promise<boolean> {
    if (this.phase().kind !== 'idle') return false;
    this.failureState.set(null);
    this.successState.set(null);
    this.phase.set({ kind: 'starting', mode, cancelRequested: false });
    this.activeBeforeSignIn = this.claude().activeAccountId;
    const started: { login: PendingClaudeLogin | null } = { login: null };
    try {
      const account = await start((login) => {
        started.login = login;
        const phase = this.phase();
        if (phase.kind === 'starting' && phase.cancelRequested) void this.app.claudeAccounts.cancelLogin.execute(login);
        else this.phase.set({ kind: 'waiting', login, pasting: false, submitting: false });
      });
      return await this.conclude(started.login, account);
    } catch (error) {
      if (started.login === null || !this.concluded.has(started.login)) this.failureState.set(error);
      this.release(started.login);
      return false;
    }
  }

  private async conclude(login: PendingClaudeLogin | null, account: ClaudeAccount | null): Promise<boolean> {
    if (login !== null && this.concluded.has(login)) return account !== null;
    if (login !== null) this.concluded.add(login);
    this.release(login);
    if (account === null) return false;
    this.successState.set({ mode: login?.mode ?? 'add', name: account.name });
    if (login?.mode === 'reauthenticate') await this.refreshStatuses();
    await this.afterAccountsChanged(this.activeBeforeSignIn);
    return true;
  }

  private release(login: PendingClaudeLogin | null): void {
    const phase = this.phase();
    if (phase.kind === 'starting' || (phase.kind === 'waiting' && phase.login === login)) this.phase.set({ kind: 'idle' });
  }

  private async change(work: () => Promise<void>): Promise<boolean> {
    this.failureState.set(null);
    this.running += 1;
    this.busyState.set(true);
    try {
      await work();
      return true;
    } catch (error) {
      this.failureState.set(error);
      return false;
    } finally {
      this.running -= 1;
      this.busyState.set(this.running > 0);
    }
  }

  private async afterAccountsChanged(previousActiveId: string | null): Promise<void> {
    await this.app.connections.check.execute('claude');
    const switched = this.claude().activeAccountId !== previousActiveId;
    await this.app.scheduler.refresh(USAGE_PAGE.id, { resetBackoff: switched });
  }
}
