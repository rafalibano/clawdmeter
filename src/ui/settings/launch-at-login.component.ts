import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18n } from '../i18n';
import { LaunchAtLoginFacade } from './launch-at-login.facade';
import { SettingsSectionComponent } from './settings-section.component';

@Component({
  selector: 'cm-launch-at-login',
  imports: [SettingsSectionComponent],
  providers: [LaunchAtLoginFacade],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cm-settings-section name="system" [heading]="i18n.t('settings.system')">
      <span summary>{{ summary() }}</span>
      <label class="check">
        <input
          type="checkbox"
          role="switch"
          data-setting="launch-at-login"
          [attr.aria-describedby]="describedBy()"
          [checked]="launchAtLogin.enabled()"
          [disabled]="launchAtLogin.busy()"
          (change)="toggle($event)"
        />
        <span>{{ i18n.t('settings.launchAtLogin') }}</span>
      </label>
      <span class="hint" id="launch-at-login-hint">{{ i18n.t('settings.launchAtLogin.hint') }}</span>
      @if (launchAtLogin.failed(); as failure) {
        <p class="error" id="launch-at-login-error" role="alert">
          {{ i18n.t(failure === 'read' ? 'settings.launchAtLogin.readError' : 'settings.launchAtLogin.error') }}
        </p>
      }
    </cm-settings-section>
  `,
  styleUrl: './launch-at-login.component.scss',
})
export class LaunchAtLoginComponent {
  protected readonly launchAtLogin = inject(LaunchAtLoginFacade);
  protected readonly i18n = inject(I18n);

  protected readonly summary = computed(() => {
    if (!this.launchAtLogin.ready() || this.launchAtLogin.failed()) return this.i18n.t('settings.launchAtLogin.unknown');
    return this.i18n.t(this.launchAtLogin.enabled() ? 'settings.launchAtLogin.on' : 'settings.launchAtLogin.off');
  });

  protected readonly describedBy = computed(() =>
    this.launchAtLogin.failed() ? 'launch-at-login-hint launch-at-login-error' : 'launch-at-login-hint',
  );

  protected toggle(event: Event): void {
    void this.launchAtLogin.set((event.target as HTMLInputElement).checked);
  }
}
