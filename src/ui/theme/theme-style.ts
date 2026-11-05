import { DEFAULT_ACCENT_COLOR, type AppearanceSettings, type SeriesColorSettings, type ThemeMode } from '../../domain/settings';
import { readableTextOn } from './color';
import { MOTTU } from './mottu-tokens';
import { SOFT_SURFACES } from './soft-surfaces';

export type ResolvedTheme = 'light' | 'dark';

export const THEME_BACKGROUNDS: Record<ResolvedTheme, string> = {
  light: SOFT_SURFACES.light.popover,
  dark: SOFT_SURFACES.dark.popover,
};

export interface ThemeRoot {
  dataset: Record<string, string | undefined>;
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): unknown;
  };
}

const BACKGROUND_OVERRIDES = {
  '--cm-muted': 66,
  '--cm-border': 8,
  '--cm-control-border': 18,
  '--cm-edge': 10,
  '--cm-hover': 8,
  '--cm-track': 10,
  '--cm-surface': 6,
} as const;

const ACCENT_OVERRIDES = ['--cm-series-five', '--cm-accent-text', '--cm-accent-active', '--cm-accent-fg-active'] as const;

export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  return mode;
}

function applySeriesColor(root: ThemeRoot, name: string, color: string | null): void {
  if (color === null) root.style.removeProperty(name);
  else root.style.setProperty(name, color);
}

export function applyThemeStyle(
  root: ThemeRoot,
  appearance: AppearanceSettings,
  resolved: ResolvedTheme,
  seriesColors: SeriesColorSettings = { fiveHour: null, sevenDay: null },
): void {
  const { accentColor, popoverBackground } = appearance;
  root.dataset['theme'] = resolved;
  root.style.setProperty('--cm-accent', accentColor);
  root.style.setProperty('--cm-accent-fg', readableTextOn(accentColor));
  if (accentColor === DEFAULT_ACCENT_COLOR) {
    for (const name of ACCENT_OVERRIDES) root.style.removeProperty(name);
  } else {
    root.style.setProperty('--cm-series-five', accentColor);
    root.style.setProperty('--cm-accent-text', accentColor);
    root.style.setProperty('--cm-accent-active', `color-mix(in srgb, ${accentColor} 65%, ${MOTTU.neutral.black})`);
    root.style.setProperty('--cm-accent-fg-active', MOTTU.neutral.white);
  }
  if (seriesColors.fiveHour !== null) root.style.setProperty('--cm-series-five', seriesColors.fiveHour);
  applySeriesColor(root, '--cm-series-seven', seriesColors.sevenDay);
  if (popoverBackground === null) {
    root.style.removeProperty('--cm-bg');
    root.style.removeProperty('--cm-fg');
    for (const name of Object.keys(BACKGROUND_OVERRIDES)) root.style.removeProperty(name);
    return;
  }
  root.style.setProperty('--cm-bg', popoverBackground);
  root.style.setProperty('--cm-fg', readableTextOn(popoverBackground));
  for (const [name, share] of Object.entries(BACKGROUND_OVERRIDES)) {
    root.style.setProperty(name, `color-mix(in srgb, var(--cm-fg) ${share}%, transparent)`);
  }
}
