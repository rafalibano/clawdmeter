import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID, MAX_CLAUDE_ACCOUNTS, MAX_CLAUDE_ACCOUNT_NAME } from '../../../domain/settings';
import { I18n } from '../../i18n';
import { APPLICATION } from '../../shell/application.token';
import { ClaudeAccountsFacade } from '../../shell/claude-accounts.facade';
import { CLAUDE_ACCOUNTS_SECTION } from '../../shell/shell-navigation.service';
import { SettingsSectionComponent } from '../settings-section.component';
import {
  addAccountView,
  claudeAccountRows,
  claudeAccountsSummary,
  clientIdView,
  errorText,
  loginText,
} from './claude-accounts-view';

const STATUS_TICK_MS = 30_000;

@Component({
  selector: 'cm-claude-accounts',
  imports: [SettingsSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './claude-accounts.component.html',
  styleUrl: './claude-accounts.component.scss',
})
export class ClaudeAccountsComponent {
  private readonly facade = inject(ClaudeAccountsFacade);
  private readonly clock = inject(APPLICATION).clock;
  private readonly now = signal(this.clock.now());
  protected readonly i18n = inject(I18n);

  protected readonly section = CLAUDE_ACCOUNTS_SECTION;
  protected readonly maxName = MAX_CLAUDE_ACCOUNT_NAME;
  protected readonly defaultClientId = DEFAULT_CLAUDE_OAUTH_CLIENT_ID;
  protected readonly claude = this.facade.claude;
  protected readonly busy = this.facade.busy;
  protected readonly loginBusy = this.facade.loginBusy;
  protected readonly renaming = signal<string | null>(null);
  protected readonly removing = signal<string | null>(null);
  private readonly clientIdDraft = signal<string | null>(null);

  protected readonly rows = computed(() =>
    claudeAccountRows(this.claude(), this.facade.statuses(), this.now(), this.i18n.localizer()),
  );
  protected readonly summary = computed(() => claudeAccountsSummary(this.claude(), this.i18n.localizer()));
  protected readonly addView = computed(() => addAccountView(this.claude(), this.loginBusy()));
  protected readonly limitText = computed(() => this.i18n.t('error.claude-account-limit', { max: MAX_CLAUDE_ACCOUNTS }));
  protected readonly clientId = computed(() => clientIdView(this.clientIdDraft(), this.claude().clientId));
  protected readonly login = computed(() => {
    const login = this.facade.login();
    return login === null ? null : { ...login, text: loginText(login, this.i18n.localizer()) };
  });
  protected readonly error = computed(() => {
    const failure = this.facade.failure();
    return failure === null ? null : errorText(failure, this.i18n.localizer());
  });

  constructor() {
    const stop = this.clock.every(STATUS_TICK_MS, () => this.now.set(this.clock.now()));
    effect(() => {
      this.claude().accounts.map((account) => account.id).join(',');
      untracked(() => void this.facade.refreshStatuses());
    });
    inject(DestroyRef).onDestroy(() => {
      stop();
      void this.facade.cancelLogin();
      this.facade.clearFailure();
    });
  }

  protected sectionToggled(open: boolean): void {
    if (!open) void this.facade.cancelLogin();
  }

  protected async add(input: HTMLInputElement): Promise<void> {
    const added = await this.facade.add(input.value);
    if (added) input.value = '';
  }

  protected reauthenticate(accountId: string): void {
    this.removing.set(null);
    this.renaming.set(null);
    void this.facade.reauthenticate(accountId);
  }

  protected startRename(accountId: string): void {
    this.facade.clearFailure();
    this.removing.set(null);
    this.renaming.set(accountId);
  }

  protected async saveRename(accountId: string, name: string): Promise<void> {
    if (await this.facade.rename(accountId, name)) this.renaming.set(null);
  }

  protected askRemove(accountId: string): void {
    this.facade.clearFailure();
    this.renaming.set(null);
    this.removing.set(accountId);
  }

  protected async confirmRemove(accountId: string): Promise<void> {
    if (await this.facade.remove(accountId)) this.removing.set(null);
  }

  protected showCodeEntry(): void {
    void this.facade.showCodeEntry();
  }

  protected submitCode(input: HTMLInputElement): void {
    void this.facade.submitCode(input.value);
  }

  protected cancelLogin(): void {
    void this.facade.cancelLogin();
  }

  protected typeClientId(event: Event): void {
    this.clientIdDraft.set((event.target as HTMLInputElement).value);
  }

  protected async saveClientId(): Promise<void> {
    const view = this.clientId();
    if (!view.canSave) return;
    if (await this.facade.setClientId(view.value)) this.clientIdDraft.set(null);
  }

  protected async resetClientId(): Promise<void> {
    if (await this.facade.setClientId(null)) this.clientIdDraft.set(null);
  }
}
