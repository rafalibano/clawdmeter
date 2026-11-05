import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import type { PageModule } from '../../application/pages';
import type { SettingsSessionError } from '../../application/session';
import { formatUpdatedAgo } from './elapsed';
import { APPLICATION } from './application.token';
import { PageStateService } from './page-state.service';
import { SettingsFacade } from './settings.facade';
import { SettingsComponent } from '../settings/settings.component';

const CLOCK_TICK_MS = 1_000;

const ERROR_MESSAGES: Record<SettingsSessionError, string> = {
  load: 'Não foi possível ler as configurações. Usando os padrões.',
  save: 'Não foi possível salvar as configurações.',
  watch: 'Edições manuais em settings.json não serão recarregadas.',
};

@Component({
  selector: 'dp-shell',
  imports: [NgComponentOutlet, SettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly facade = inject(SettingsFacade);
  private readonly pageState = inject(PageStateService);
  private readonly clock = inject(APPLICATION).clock;
  private readonly now = signal(this.clock.now());
  private readonly requestedPageId = signal<string | null>(null);

  protected readonly showingSettings = signal(false);
  protected readonly pages = this.facade.enabledPages;
  protected readonly errorMessage = computed(() => {
    const error = this.facade.error();
    return error === null ? null : ERROR_MESSAGES[error];
  });
  protected readonly current = computed<PageModule | null>(
    () => this.pages().find((page) => page.id === this.requestedPageId()) ?? this.pages()[0] ?? null,
  );
  protected readonly updatedAgo = computed(() => {
    const page = this.current();
    const update = page ? this.pageState.of(page.id)() : undefined;
    return formatUpdatedAgo(update?.at ?? null, this.now());
  });

  constructor() {
    const stop = this.clock.every(CLOCK_TICK_MS, () => this.now.set(this.clock.now()));
    inject(DestroyRef).onDestroy(stop);
  }

  protected select(id: string): void {
    this.requestedPageId.set(id);
    this.showingSettings.set(false);
  }

  protected toggleSettings(): void {
    this.showingSettings.update((open) => !open);
  }
}
