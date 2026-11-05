import type { AppLanguage, AppSettings, AppearanceSettings, SeriesColorSettings } from './app-settings';
import { THEME_MODES, isAppLanguage } from './app-settings';
import { isProjectionMethod, type ProjectionMethod } from '../usage/projection-method';
import { isHexColor } from './hex-color';
import type { PageId } from './page-id';

export interface SettingsPatch {
  enabledPages?: Record<PageId, boolean>;
  appearance?: Partial<AppearanceSettings>;
  language?: AppLanguage;
  projectionMethod?: ProjectionMethod;
  seriesColors?: Partial<SeriesColorSettings>;
}

export function mergePatches(first: SettingsPatch, second: SettingsPatch): SettingsPatch {
  const merged: SettingsPatch = {
    enabledPages: { ...first.enabledPages, ...second.enabledPages },
    appearance: { ...first.appearance, ...second.appearance },
  };
  const language = second.language ?? first.language;
  if (language !== undefined) merged.language = language;
  const projectionMethod = second.projectionMethod ?? first.projectionMethod;
  if (projectionMethod !== undefined) merged.projectionMethod = projectionMethod;
  if (first.seriesColors !== undefined || second.seriesColors !== undefined) {
    merged.seriesColors = { ...first.seriesColors, ...second.seriesColors };
  }
  return merged;
}

function applyAppearance(current: AppearanceSettings, patch: Partial<AppearanceSettings>): AppearanceSettings {
  const next = { ...current };
  if (isHexColor(patch.accentColor)) next.accentColor = patch.accentColor.toLowerCase();
  if (patch.popoverBackground === null) next.popoverBackground = null;
  else if (isHexColor(patch.popoverBackground)) next.popoverBackground = patch.popoverBackground.toLowerCase();
  if (patch.theme !== undefined && THEME_MODES.includes(patch.theme)) next.theme = patch.theme;
  return next;
}

function applySeriesColor(current: string | null, patch: string | null | undefined): string | null {
  if (patch === null) return null;
  return isHexColor(patch) ? patch.toLowerCase() : current;
}

function applySeriesColors(current: SeriesColorSettings, patch: Partial<SeriesColorSettings>): SeriesColorSettings {
  return {
    fiveHour: applySeriesColor(current.fiveHour, patch.fiveHour),
    sevenDay: applySeriesColor(current.sevenDay, patch.sevenDay),
  };
}

export function applyPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    ...current,
    enabledPages: { ...current.enabledPages, ...patch.enabledPages },
    appearance: applyAppearance(current.appearance, patch.appearance ?? {}),
    language: isAppLanguage(patch.language) ? patch.language : current.language,
    projectionMethod: isProjectionMethod(patch.projectionMethod) ? patch.projectionMethod : current.projectionMethod,
    seriesColors: applySeriesColors(current.seriesColors, patch.seriesColors ?? {}),
  };
}
