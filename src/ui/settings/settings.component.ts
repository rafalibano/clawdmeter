import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DEFAULT_ACCENT_COLOR, isPageEnabled, THEME_MODES, type ThemeMode } from '../../domain/settings';
import { SettingsFacade } from '../shell/settings.facade';
import { ACCENT_PRESETS } from '../theme/accent-presets';
import { ConnectionsComponent } from './connections/connections.component';

const THEME_LABELS: Record<ThemeMode, string> = {
  light: 'Claro',
  dark: 'Escuro',
  system: 'Sistema',
};

@Component({
  selector: 'dp-settings',
  imports: [ConnectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly facade = inject(SettingsFacade);

  protected readonly settings = this.facade.settings;
  protected readonly pages = this.facade.pages;
  protected readonly presets = ACCENT_PRESETS;
  protected readonly themes = THEME_MODES.map((mode) => ({ mode, label: THEME_LABELS[mode] }));
  protected readonly defaultBackgroundPreview = '#ffffff';

  protected isEnabled(id: string): boolean {
    return isPageEnabled(this.settings(), id);
  }

  protected togglePage(id: string, enabled: boolean): void {
    this.facade.update({ enabledPages: { [id]: enabled } });
  }

  protected setAccent(color: string): void {
    this.facade.update({ appearance: { accentColor: color } });
  }

  protected resetAccent(): void {
    this.setAccent(DEFAULT_ACCENT_COLOR);
  }

  protected setBackground(color: string | null): void {
    this.facade.update({ appearance: { popoverBackground: color } });
  }

  protected setTheme(mode: ThemeMode): void {
    this.facade.update({ appearance: { theme: mode } });
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checkedOf(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
