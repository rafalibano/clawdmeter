import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { isPageEnabled, THEME_MODES, type ThemeMode } from '../../domain/settings';
import { SettingsFacade } from '../shell/settings.facade';
import { ThemeService } from '../theme/theme.service';
import { ACCENT_PRESETS, BACKGROUND_PRESETS } from '../theme/accent-presets';
import { THEME_BACKGROUNDS } from '../theme/theme-style';
import { ColorPickerComponent } from './color-picker.component';
import { ConnectionsComponent } from './connections/connections.component';

const THEME_LABELS: Record<ThemeMode, string> = {
  light: 'Claro',
  dark: 'Escuro',
  system: 'Sistema',
};

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

  protected readonly settings = this.facade.settings;
  protected readonly accentPresets = ACCENT_PRESETS;
  protected readonly backgroundPresets = BACKGROUND_PRESETS;
  protected readonly themes = THEME_MODES.map((mode) => ({ mode, label: THEME_LABELS[mode] }));
  protected readonly pageRows = computed(() =>
    this.facade.pages().map((page) => ({
      id: page.id,
      title: page.title,
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

  protected checkedOf(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
