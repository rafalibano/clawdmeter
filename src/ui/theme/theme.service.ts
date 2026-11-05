import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { SettingsFacade } from '../shell/settings.facade';
import { applyThemeStyle, resolveTheme } from './theme-style';

const DARK_QUERY = '(prefers-color-scheme: dark)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly facade = inject(SettingsFacade);
  private readonly media = window.matchMedia(DARK_QUERY);
  private readonly systemDark = signal(this.media.matches);

  readonly resolved = computed(() => resolveTheme(this.facade.settings().appearance.theme, this.systemDark()));

  constructor() {
    const listener = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    this.media.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => this.media.removeEventListener('change', listener));
    effect(() => {
      const settings = this.facade.settings();
      applyThemeStyle(document.documentElement, settings.appearance, this.resolved(), settings.seriesColors);
    });
  }
}
