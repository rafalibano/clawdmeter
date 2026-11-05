import { DEFAULT_ACCENT_COLOR } from '../../domain/settings';
import type { UsageWindowKind } from '../../domain/usage';
import { THEME_BACKGROUNDS, type ResolvedTheme } from './theme-style';
import { readableTextOn } from './color';
import { MOTTU } from './mottu-tokens';
import { SOFT_SURFACES } from './soft-surfaces';

const WEEKLY_NEUTRAL = { dark: '#a9a9a9', light: '#767676' } as const;

export const CHART_FONT_FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export interface SeriesColors {
  line: string;
  area: string;
  areaFade: string;
  marker: string;
}

export interface ChartPalette {
  series: Record<UsageWindowKind, SeriesColors>;
  text: string;
  muted: string;
  grid: string;
  now: string;
  danger: string;
  attention: string;
  tooltipBackground: string;
  tooltipBorder: string;
  fontFamily: string;
}

export function withAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function seriesColors(line: string): SeriesColors {
  return { line, area: withAlpha(line, 0.1), areaFade: withAlpha(line, 0), marker: withAlpha(line, 0.28) };
}

export function chartPalette(accent: string, popoverBackground: string | null, theme: ResolvedTheme): ChartPalette {
  const text = readableTextOn(popoverBackground ?? THEME_BACKGROUNDS[theme]);
  const dark = theme === 'dark';
  const fiveHour = accent === DEFAULT_ACCENT_COLOR ? (dark ? MOTTU.primary.alt : MOTTU.primary.base) : accent;
  return {
    series: {
      fiveHour: seriesColors(fiveHour),
      sevenDay: seriesColors(dark ? WEEKLY_NEUTRAL.dark : WEEKLY_NEUTRAL.light),
    },
    text,
    muted: withAlpha(text, 0.62),
    grid: withAlpha(text, 0.06),
    now: withAlpha(text, 0.3),
    danger: MOTTU.alert.base,
    attention: MOTTU.amarelo1,
    tooltipBackground: popoverBackground ?? SOFT_SURFACES[theme].card,
    tooltipBorder: withAlpha(text, 0.12),
    fontFamily: CHART_FONT_FAMILY,
  };
}
