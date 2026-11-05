import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  APP_LANGUAGES,
  THEME_MODES,
  isPageEnabled,
  isValidUsageThresholds,
  type AppLanguage,
  type ThemeMode,
} from '../../domain/settings';
import { I18n } from '../i18n';
import { SettingsFacade } from '../shell/settings.facade';
import { ThemeService } from '../theme/theme.service';
import { ACCENT_PRESETS, BACKGROUND_PRESETS } from '../theme/accent-presets';
import { THEME_BACKGROUNDS } from '../theme/theme-style';
import { ColorPickerComponent } from './color-picker.component';
import { ConnectionsComponent } from './connections/connections.component';

@Component({
  selector: 'dp-settings',
  imports: [ColorPickerComponent, ConnectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly facade = inject(SettingsFacade);
  private readonly theme = inject(ThemeService);
  protected readonly i18n = inject(I18n);
  private readonly warningDraft = signal<string | null>(null);
  private readonly criticalDraft = signal<string | null>(null);

  protected readonly settings = this.facade.settings;
  protected readonly accentPresets = ACCENT_PRESETS;
  protected readonly backgroundPresets = BACKGROUND_PRESETS;
  protected readonly themes = THEME_MODES;
  protected readonly languages = APP_LANGUAGES;
  protected readonly warningText = computed(() => this.warningDraft() ?? String(this.settings().usageThresholds.warning));
  protected readonly criticalText = computed(() => this.criticalDraft() ?? String(this.settings().usageThresholds.critical));
  protected readonly thresholdsInvalid = computed(
    () => !isValidUsageThresholds({ warning: Number(this.warningText()), critical: Number(this.criticalText()) }),
  );
  protected readonly pageRows = computed(() =>
    this.facade.pages().map((page) => ({
      id: page.id,
      title: this.i18n.pageTitle(page.id, page.title),
      enabled: isPageEnabled(this.settings(), page.id),
    })),
  );
  protected readonly backgroundValue = computed(
    () => this.settings().appearance.popoverBackground ?? THEME_BACKGROUNDS[this.theme.resolved()],
  );

  protected togglePage(id: string, enabled: boolean): void {
    this.facade.update({ enabledPages: { [id]: enabled } });
  }

  protected setAccent(color: string): void {
    this.facade.update({ appearance: { accentColor: color } });
  }

  protected setBackground(color: string | null): void {
    this.facade.update({ appearance: { popoverBackground: color } });
  }

  protected setTheme(mode: ThemeMode): void {
    this.facade.update({ appearance: { theme: mode } });
  }

  protected languageLabel(language: AppLanguage): string {
    return this.i18n.t(`language.${language}`);
  }

  protected themeLabel(mode: ThemeMode): string {
    return this.i18n.t(`theme.${mode}`);
  }

  protected setLanguage(language: AppLanguage): void {
    this.facade.update({ language });
  }

  protected setThreshold(field: 'warning' | 'critical', event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    (field === 'warning' ? this.warningDraft : this.criticalDraft).set(text);
    const warning = Number(field === 'warning' ? text : this.warningText());
    const critical = Number(field === 'critical' ? text : this.criticalText());
    if (text.trim() !== '' && isValidUsageThresholds({ warning, critical })) {
      this.facade.update({ usageThresholds: { warning, critical } });
      this.warningDraft.set(null);
      this.criticalDraft.set(null);
    }
  }

  protected checkedOf(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
