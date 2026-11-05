import type { AppLanguage, AppSettings, AppearanceSettings } from './app-settings';
import { THEME_MODES, isAppLanguage } from './app-settings';
import { isHexColor } from './hex-color';
import type { PageId } from './page-id';

export interface SettingsPatch {
  enabledPages?: Record<PageId, boolean>;
  appearance?: Partial<AppearanceSettings>;
  language?: AppLanguage;
}

export function mergePatches(first: SettingsPatch, second: SettingsPatch): SettingsPatch {
  const merged: SettingsPatch = {
    enabledPages: { ...first.enabledPages, ...second.enabledPages },
    appearance: { ...first.appearance, ...second.appearance },
  };
  const language = second.language ?? first.language;
  if (language !== undefined) merged.language = language;
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

export function applyPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    ...current,
    enabledPages: { ...current.enabledPages, ...patch.enabledPages },
    appearance: applyAppearance(current.appearance, patch.appearance ?? {}),
    language: isAppLanguage(patch.language) ? patch.language : current.language,
  };
}
