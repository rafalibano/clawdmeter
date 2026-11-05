import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { SettingsFacade } from '../shell/settings.facade';
import { readableTextOn } from './color';

const DARK_QUERY = '(prefers-color-scheme: dark)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly facade = inject(SettingsFacade);
  private readonly media = window.matchMedia(DARK_QUERY);
  private readonly systemDark = signal(this.media.matches);

  readonly resolved = computed(() => {
    const { theme } = this.facade.settings().appearance;
    if (theme === 'system') return this.systemDark() ? 'dark' : 'light';
    return theme;
  });

  constructor() {
    const listener = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    this.media.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => this.media.removeEventListener('change', listener));
    effect(() => this.apply());
  }

  private apply(): void {
    const root = document.documentElement;
    const { accentColor, popoverBackground } = this.facade.settings().appearance;
    root.dataset['theme'] = this.resolved();
    root.style.setProperty('--dp-accent', accentColor);
    root.style.setProperty('--dp-accent-fg', readableTextOn(accentColor));
    if (popoverBackground === null) {
      root.style.removeProperty('--dp-bg');
      root.style.removeProperty('--dp-fg');
    } else {
      root.style.setProperty('--dp-bg', popoverBackground);
      root.style.setProperty('--dp-fg', readableTextOn(popoverBackground));
    }
  }
}
