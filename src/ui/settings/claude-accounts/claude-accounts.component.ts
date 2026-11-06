import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  DEFAULT_CLAUDE_OAUTH_CLIENT_ID,
  MAX_CLAUDE_ACCOUNTS,
  MAX_CLAUDE_ACCOUNT_NAME,
  accountNameProblem,
  type ClaudeAccountNameProblem,
} from '../../../domain/settings';
import { I18n } from '../../i18n';
import { ClaudeAccountsFacade } from '../../shell/claude-accounts.facade';
import { CLAUDE_ACCOUNTS_SECTION } from '../../shell/shell-navigation.service';
import { SettingsSectionComponent } from '../settings-section.component';
import {
  accountNameProblemText,
  addAccountView,
  claudeAccountRows,
  claudeAccountsSummary,
  clientIdView,
  errorText,
  loginStatusText,
} from './claude-accounts-view';

const NAME_INPUT = '#claude-account-name';

@Component({
  selector: 'cm-claude-accounts',
  imports: [SettingsSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './claude-accounts.component.html',
  styleUrl: './claude-accounts.component.scss',
})
export class ClaudeAccountsComponent {
  private readonly facade = inject(ClaudeAccountsFacade);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  protected readonly i18n = inject(I18n);

  protected readonly section = CLAUDE_ACCOUNTS_SECTION;
  protected readonly maxName = MAX_CLAUDE_ACCOUNT_NAME;
  protected readonly defaultClientId = DEFAULT_CLAUDE_OAUTH_CLIENT_ID;
  protected readonly claude = this.facade.claude;
  protected readonly busy = this.facade.busy;
  protected readonly loginBusy = this.facade.loginBusy;
  protected readonly login = this.facade.login;
  protected readonly startOpen = computed(() => untracked(() => this.claude().accounts.length === 0));
  protected readonly renaming = signal<string | null>(null);
  protected readonly removing = signal<string | null>(null);
  protected readonly nameDraft = signal('');
  private readonly nameProblem = signal<ClaudeAccountNameProblem | null>(null);
  private readonly clientIdDraft = signal<string | null>(null);
  private readonly accountIds = computed(() => this.claude().accounts.map((account) => account.id).join(','));
  private readonly loginShown = computed(() => this.login() !== null);

  protected readonly rows = computed(() => claudeAccountRows(this.claude(), this.facade.statuses(), this.i18n.localizer()));
  protected readonly summary = computed(() => claudeAccountsSummary(this.claude(), this.i18n.localizer()));
  protected readonly addView = computed(() => addAccountView(this.claude(), this.loginBusy()));
  protected readonly limitText = computed(() => this.i18n.t('error.claude-account-limit', { max: MAX_CLAUDE_ACCOUNTS }));
  protected readonly clientId = computed(() => clientIdView(this.clientIdDraft(), this.claude().clientId));
  protected readonly statusText = computed(() => loginStatusText(this.login(), this.facade.success(), this.i18n.localizer()));
  protected readonly nameError = computed(() => {
    const problem = this.nameProblem();
    return problem === null ? null : accountNameProblemText(problem, this.i18n.localizer());
  });
  protected readonly nameDescription = computed(() => {
    if (this.nameError() !== null) return 'claude-account-name-error';
    return this.addView().limitReached ? 'claude-account-limit' : 'claude-account-hint';
  });
  protected readonly error = computed(() => {
    const failure = this.facade.failure();
    return failure === null ? null : errorText(failure, this.i18n.localizer());
  });

  constructor() {
    this.facade.clearFailure();
    effect(() => {
      this.accountIds();
      untracked(() => void this.facade.refreshStatuses());
    });
    effect(() => {
      if (this.loginShown()) untracked(() => this.focusLater('[data-action="cancel-login"]'));
    });
    inject(DestroyRef).onDestroy(() => {
      void this.facade.cancelLogin();
      this.facade.clearFailure();
    });
  }

  protected sectionToggled(open: boolean): void {
    if (!open) void this.facade.cancelLogin();
  }

  protected typeName(event: Event): void {
    this.nameDraft.set((event.target as HTMLInputElement).value);
    this.nameProblem.set(null);
  }

  protected async add(): Promise<void> {
    const name = this.nameDraft();
    const problem = accountNameProblem(name, this.claude().accounts);
    if (problem !== null) {
      this.nameProblem.set(problem);
      this.focusLater(NAME_INPUT);
      return;
    }
    if (await this.facade.add(name)) this.nameDraft.set('');
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
    this.focusLater(this.rowAction(accountId, 'rename-input'), true);
  }

  protected renameKey(event: KeyboardEvent, accountId: string): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.cancelRename(accountId);
  }

  protected cancelRename(accountId: string): void {
    this.renaming.set(null);
    this.focusLater(this.rowAction(accountId, 'rename'));
  }

  protected async saveRename(accountId: string, name: string): Promise<void> {
    if (!(await this.facade.rename(accountId, name))) return;
    this.renaming.set(null);
    this.focusLater(this.rowAction(accountId, 'rename'));
  }

  protected askRemove(accountId: string): void {
    this.facade.clearFailure();
    this.renaming.set(null);
    this.removing.set(accountId);
    this.focusLater(this.rowAction(accountId, 'cancel-remove'));
  }

  protected cancelRemove(accountId: string): void {
    this.removing.set(null);
    this.focusLater(this.rowAction(accountId, 'remove'));
  }

  protected async confirmRemove(accountId: string): Promise<void> {
    if (!(await this.facade.remove(accountId))) return;
    this.removing.set(null);
    this.focusLater(NAME_INPUT);
  }

  protected showCodeEntry(): void {
    void this.facade.showCodeEntry();
    this.focusLater('#claude-login-code');
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
    const view = this.clientId();
    if (view.isDefault) {
      this.clientIdDraft.set(null);
      return;
    }
    if (await this.facade.setClientId(null)) this.clientIdDraft.set(null);
  }

  private rowAction(accountId: string, action: string): string {
    return `[data-account="${CSS.escape(accountId)}"] [data-action="${action}"]`;
  }

  private focusLater(selector: string, select = false): void {
    afterNextRender(
      () => {
        const element = this.host.querySelector<HTMLElement>(selector);
        element?.focus();
        if (select && element instanceof HTMLInputElement) element.select();
      },
      { injector: this.injector },
    );
  }
}
