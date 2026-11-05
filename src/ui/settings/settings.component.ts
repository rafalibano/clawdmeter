import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  APP_LANGUAGES,
  THEME_MODES,
  isMaintenancePage,
  isPageEnabled,
  type AppLanguage,
  type SeriesColorSettings,
  type ThemeMode,
} from '../../domain/settings';
import { PROJECTION_METHODS, type ProjectionMethod } from '../../domain/usage';
import { I18n } from '../i18n';
import { SettingsFacade } from '../shell/settings.facade';
import { ThemeService } from '../theme/theme.service';
import { ACCENT_PRESETS, BACKGROUND_PRESETS, SERIES_PRESETS } from '../theme/accent-presets';
import { seriesLineColors } from '../theme/chart-palette';
import { THEME_BACKGROUNDS } from '../theme/theme-style';
import { ColorPickerComponent } from './color-picker.component';
import { seriesLineRows } from './series-lines';
import { ConnectionsComponent } from './connections/connections.component';

@Component({
  selector: 'cm-settings',
  imports: [ColorPickerComponent, ConnectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly facade = inject(SettingsFacade);
  private readonly theme = inject(ThemeService);
  protected readonly i18n = inject(I18n);

  protected readonly settings = this.facade.settings;
  protected readonly accentPresets = ACCENT_PRESETS;
  protected readonly backgroundPresets = BACKGROUND_PRESETS;
  protected readonly seriesPresets = SERIES_PRESETS;
  protected readonly themes = THEME_MODES;
  protected readonly languages = APP_LANGUAGES;
  protected readonly projectionMethods = PROJECTION_METHODS;
  protected readonly pageRows = computed(() =>
    this.facade.pages().map((page) => ({
      id: page.id,
      title: this.i18n.pageTitle(page.id, page.title),
      enabled: isPageEnabled(this.settings(), page.id),
      maintenance: isMaintenancePage(page.id),
    })),
  );
  protected readonly backgroundValue = computed(
    () => this.settings().appearance.popoverBackground ?? THEME_BACKGROUNDS[this.theme.resolved()],
  );

  protected readonly seriesValues = computed(() =>
    seriesLineColors(this.settings().appearance.accentColor, this.theme.resolved(), this.settings().seriesColors),
  );

  protected readonly seriesRows = computed(() => seriesLineRows(this.seriesValues(), this.settings().seriesColors));
  protected readonly seriesOpen = signal(false);

  protected toggleSeries(): void {
    this.seriesOpen.update((open) => !open);
  }

  protected setSeriesColor(kind: keyof SeriesColorSettings, color: string | null): void {
    this.facade.update({ seriesColors: { [kind]: color } });
  }

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

  protected projectionLabel(method: ProjectionMethod): string {
    return this.i18n.t(`projection.${method}`);
  }

  protected setProjection(projectionMethod: ProjectionMethod): void {
    this.facade.update({ projectionMethod });
  }

  protected setLanguage(language: AppLanguage): void {
    this.facade.update({ language });
  }

  protected checkedOf(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
