import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, signal } from '@angular/core';
import type { PageModule } from '../../application/pages';
import type { StartupNotice } from '../../application/ports';
import { I18n } from '../i18n';
import { REFRESH_COOLDOWN_MS, refreshState } from './refresh-state';
import { APPLICATION } from './application.token';
import { PageStateService } from './page-state.service';
import { SettingsFacade } from './settings.facade';
import { SettingsComponent } from '../settings/settings.component';

const CLOCK_TICK_MS = 1_000;

@Component({
  selector: 'cm-shell',
  imports: [NgComponentOutlet, SettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly facade = inject(SettingsFacade);
  protected readonly i18n = inject(I18n);
  private readonly app = inject(APPLICATION);
  private readonly scheduler = this.app.scheduler;
  private readonly pageState = inject(PageStateService);
  private readonly clock = this.app.clock;
  private readonly now = signal(this.clock.now());
  private readonly requestedPageId = signal<string | null>(null);

  private readonly refreshing = signal(false);
  private readonly cooldowns = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly showingSettings = signal(false);
  private readonly pendingNotice = signal<StartupNotice | null>(null);
  protected readonly noticeMessage = computed(() => {
    const notice = this.pendingNotice();
    return notice === null ? null : this.i18n.t(`shell.notice.${notice}`);
  });
  protected readonly pages = this.facade.enabledPages;
  protected readonly errorMessage = computed(() => {
    const error = this.facade.error();
    return error === null ? null : this.i18n.t(`shell.error.${error}`);
  });
  protected readonly current = computed<PageModule | null>(
    () => this.pages().find((page) => page.id === this.requestedPageId()) ?? this.pages()[0] ?? null,
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
    void this.app.loadStartupNotice.execute().then((notice) => this.pendingNotice.set(notice));
    const stop = this.clock.every(CLOCK_TICK_MS, () => this.now.set(this.clock.now()));
    inject(DestroyRef).onDestroy(stop);
  }

  protected select(id: string): void {
    this.requestedPageId.set(id);
    this.showingSettings.set(false);
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

  protected dismissNotice(): void {
    this.pendingNotice.set(null);
  }

  protected toggleSettings(): void {
    this.showingSettings.update((open) => !open);
  }
}
