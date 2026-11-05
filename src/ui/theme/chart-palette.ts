import { THEME_BACKGROUNDS, type ResolvedTheme } from './theme-style';
import { readableTextOn } from './color';

export interface ChartPalette {
  line: string;
  trend: string;
  text: string;
  muted: string;
  grid: string;
  danger: string;
}

export function withAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function chartPalette(accent: string, popoverBackground: string | null, theme: ResolvedTheme): ChartPalette {
  const text = readableTextOn(popoverBackground ?? THEME_BACKGROUNDS[theme]);
  return {
    line: accent,
    trend: accent,
    text,
    muted: withAlpha(text, 0.58),
    grid: withAlpha(text, 0.14),
    danger: '#ef4444',
  };
}
