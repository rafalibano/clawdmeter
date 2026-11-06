import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, signal } from '@angular/core';
import type { PageModule } from '../../application/pages';
import { I18n } from '../i18n';
import { USAGE_PAGE } from '../pages/usage/usage-page-ref';
import { REFRESH_COOLDOWN_MS, refreshState } from './refresh-state';
import { APPLICATION } from './application.token';
import { AccountSwitchComponent } from './account-switch.component';
import { accountSwitchView } from './account-switch-view';
import { ClaudeAccountsFacade } from './claude-accounts.facade';
import { PageStateService } from './page-state.service';
import { SettingsFacade } from './settings.facade';
import { ShellNavigation } from './shell-navigation.service';
import { errorText } from '../settings/claude-accounts/claude-accounts-view';
import { SettingsComponent } from '../settings/settings.component';
import { UpdateBannerComponent } from '../updates/update-banner.component';

const CLOCK_TICK_MS = 1_000;
const SWITCH_ERROR_MS = 10_000;
const ACCOUNT_OPTION_ID = 'cm-account-option';

@Component({
  selector: 'cm-shell',
  imports: [AccountSwitchComponent, NgComponentOutlet, SettingsComponent, UpdateBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly facade = inject(SettingsFacade);
  private readonly navigation = inject(ShellNavigation);
  private readonly claudeAccounts = inject(ClaudeAccountsFacade);
  protected readonly i18n = inject(I18n);
  private readonly scheduler = inject(APPLICATION).scheduler;
  private readonly pageState = inject(PageStateService);
  private readonly clock = inject(APPLICATION).clock;
  private readonly now = signal(this.clock.now());
  private readonly requestedPageId = signal<string | null>(null);

  private readonly refreshing = signal(false);
  private readonly cooldowns = signal<ReadonlyMap<string, number>>(new Map());
  private readonly switchFailure = signal<{ error: unknown; at: number } | null>(null);

  protected readonly showingSettings = this.navigation.settingsOpen;
  protected readonly pages = this.facade.enabledPages;
  protected readonly errorMessage = computed(() => {
    const failed = this.switchFailure();
    if (failed !== null && this.now() - failed.at < SWITCH_ERROR_MS) return errorText(failed.error, this.i18n.localizer());
    const error = this.facade.error();
    return error === null ? null : this.i18n.t(`shell.error.${error}`);
  });
  protected readonly current = computed<PageModule | null>(
    () => this.pages().find((page) => page.id === this.requestedPageId()) ?? this.pages()[0] ?? null,
  );
  protected readonly accountSwitch = computed(() =>
    this.showingSettings()
      ? null
      : accountSwitchView(this.facade.settings().claude, this.current()?.id ?? null, USAGE_PAGE.id, ACCOUNT_OPTION_ID),
  );
  protected readonly updatedAgo = computed(() => {
    const page = this.current();
    const update = page ? this.pageState.get(page) : undefined;
    return this.i18n.localizer().updatedAgo(update?.at ?? null, this.now());
  });
  protected readonly refresh = computed(() => {
    const page = this.current();
    const update = page ? this.pageState.get(page) : undefined;
    const state = refreshState({
      now: this.now(),
      loading: this.refreshing(),
      cooldownUntil: page ? (this.cooldowns().get(page.id) ?? 0) : 0,
      backoffUntil: update?.status === 'error' ? (update.rateLimitedUntil ?? null) : null,
    });
    const tooltip = state.tooltip;
    const l = this.i18n.localizer();
    const text = 'remainingMs' in tooltip ? l.t(tooltip.key, { span: l.span(tooltip.remainingMs) }) : l.t(tooltip.key);
    return { ...state, text };
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterRenderEffect(() => {
      const id = this.current()?.id;
      if (!id || this.showingSettings()) return;
      host.querySelector(`.tab[data-page-id="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    const stop = this.clock.every(CLOCK_TICK_MS, () => this.now.set(this.clock.now()));
    inject(DestroyRef).onDestroy(stop);
  }

  protected select(id: string): void {
    this.requestedPageId.set(id);
    this.navigation.closeSettings();
  }

  protected async selectAccount(accountId: string): Promise<void> {
    this.switchFailure.set(null);
    if (await this.claudeAccounts.select(accountId)) return;
    this.switchFailure.set({ error: this.claudeAccounts.failure(), at: this.clock.now() });
    this.claudeAccounts.clearFailure();
  }

  protected async reload(): Promise<void> {
    const page = this.current();
    if (!page || this.refresh().disabled) return;
    this.refreshing.set(true);
    this.cooldowns.update((current) => new Map(current).set(page.id, this.clock.now() + REFRESH_COOLDOWN_MS));
    try {
      await this.scheduler.refresh(page.id);
    } finally {
      this.refreshing.set(false);
    }
  }

  protected toggleSettings(): void {
    this.navigation.toggleSettings();
  }
}
