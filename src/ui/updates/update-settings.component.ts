import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { I18n } from '../i18n';
import { APPLICATION } from '../shell/application.token';
import { SettingsSectionComponent } from '../settings/settings-section.component';
import { canCheckNow, lastCheckText, statusText, updatesSummary } from './update-view';
import { UpdatesFacade } from './updates.facade';

const CLOCK_TICK_MS = 30_000;

@Component({
  selector: 'cm-update-settings',
  imports: [SettingsSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './update-settings.component.html',
  styleUrl: './update-settings.component.scss',
})
export class UpdateSettingsComponent {
  protected readonly updates = inject(UpdatesFacade);
  protected readonly i18n = inject(I18n);
  private readonly clock = inject(APPLICATION).clock;
  private readonly now = signal(this.clock.now());

  protected readonly snapshot = this.updates.snapshot;
  protected readonly status = computed(() => this.snapshot().status);
  protected readonly summary = computed(() => updatesSummary(this.i18n.localizer(), this.snapshot()));
  protected readonly statusLine = computed(() => statusText(this.i18n.localizer(), this.status()));
  protected readonly lastCheck = computed(() => lastCheckText(this.i18n.localizer(), this.snapshot(), this.now()));
  protected readonly canCheck = computed(() => canCheckNow(this.status()));

  constructor() {
    const stop = this.clock.every(CLOCK_TICK_MS, () => this.now.set(this.clock.now()));
    inject(DestroyRef).onDestroy(stop);
  }

  protected checkNow(): void {
    this.now.set(this.clock.now());
    void this.updates.checkNow();
  }

  protected retry(): void {
    const status = this.status();
    if (status.state === 'error' && status.during === 'install') this.install();
    else this.checkNow();
  }

  protected install(): void {
    void this.updates.install();
  }

  protected restart(): void {
    void this.updates.restart();
  }
}
