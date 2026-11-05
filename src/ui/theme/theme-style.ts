import { DEFAULT_ACCENT_COLOR, type AppearanceSettings, type ThemeMode } from '../../domain/settings';
import { readableTextOn } from './color';
import { MOTTU } from './mottu-tokens';

export type ResolvedTheme = 'light' | 'dark';

export const THEME_BACKGROUNDS: Record<ResolvedTheme, string> = {
  light: MOTTU.neutral.white,
  dark: MOTTU.neutral.black,
};

export interface ThemeRoot {
  dataset: Record<string, string | undefined>;
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): unknown;
  };
}

const BACKGROUND_OVERRIDES = {
  '--dp-muted': 58,
  '--dp-border': 14,
  '--dp-surface': 6,
} as const;

const ACCENT_OVERRIDES = ['--dp-accent-text', '--dp-accent-active', '--dp-accent-fg-active'] as const;

export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  return mode;
}

export function applyThemeStyle(root: ThemeRoot, appearance: AppearanceSettings, resolved: ResolvedTheme): void {
  const { accentColor, popoverBackground } = appearance;
  root.dataset['theme'] = resolved;
  root.style.setProperty('--dp-accent', accentColor);
  root.style.setProperty('--dp-accent-fg', readableTextOn(accentColor));
  if (accentColor === DEFAULT_ACCENT_COLOR) {
    for (const name of ACCENT_OVERRIDES) root.style.removeProperty(name);
  } else {
    root.style.setProperty('--dp-accent-text', accentColor);
    root.style.setProperty('--dp-accent-active', `color-mix(in srgb, ${accentColor} 65%, ${MOTTU.neutral.black})`);
    root.style.setProperty('--dp-accent-fg-active', MOTTU.neutral.white);
  }
  if (popoverBackground === null) {
    root.style.removeProperty('--dp-bg');
    root.style.removeProperty('--dp-fg');
    for (const name of Object.keys(BACKGROUND_OVERRIDES)) root.style.removeProperty(name);
    return;
  }
  root.style.setProperty('--dp-bg', popoverBackground);
  root.style.setProperty('--dp-fg', readableTextOn(popoverBackground));
  for (const [name, share] of Object.entries(BACKGROUND_OVERRIDES)) {
    root.style.setProperty(name, `color-mix(in srgb, var(--dp-fg) ${share}%, transparent)`);
  }
}
