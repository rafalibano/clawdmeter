import { DEFAULT_ACCENT_COLOR } from '../../domain/settings';
import { THEME_BACKGROUNDS, type ResolvedTheme } from './theme-style';
import { readableTextOn } from './color';
import { MOTTU } from './mottu-tokens';

export const CHART_FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export interface ChartPalette {
  line: string;
  trend: string;
  area: string;
  text: string;
  muted: string;
  grid: string;
  danger: string;
  fontFamily: string;
}

export function withAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function chartPalette(accent: string, popoverBackground: string | null, theme: ResolvedTheme): ChartPalette {
  const text = readableTextOn(popoverBackground ?? THEME_BACKGROUNDS[theme]);
  return {
    line: accent,
    trend: accent === DEFAULT_ACCENT_COLOR ? MOTTU.primary.alt : accent,
    area: accent,
    text,
    muted: withAlpha(text, 0.58),
    grid: withAlpha(text, 0.14),
    danger: MOTTU.alert.base,
    fontFamily: CHART_FONT_FAMILY,
  };
}
