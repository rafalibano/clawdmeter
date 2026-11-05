import type { AppearanceSettings, ThemeMode } from '../../domain/settings';
import { readableTextOn } from './color';

export type ResolvedTheme = 'light' | 'dark';

export const THEME_BACKGROUNDS: Record<ResolvedTheme, string> = {
  light: '#ffffff',
  dark: '#1c1c1e',
};

export interface ThemeRoot {
  dataset: Record<string, string | undefined>;
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): unknown;
  };
}

export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  return mode;
}

export function applyThemeStyle(root: ThemeRoot, appearance: AppearanceSettings, resolved: ResolvedTheme): void {
  const { accentColor, popoverBackground } = appearance;
  root.dataset['theme'] = resolved;
  root.style.setProperty('--dp-accent', accentColor);
  root.style.setProperty('--dp-accent-fg', readableTextOn(accentColor));
  if (popoverBackground === null) {
    root.style.removeProperty('--dp-bg');
    root.style.removeProperty('--dp-fg');
    return;
  }
  root.style.setProperty('--dp-bg', popoverBackground);
  root.style.setProperty('--dp-fg', readableTextOn(popoverBackground));
}
