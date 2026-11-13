import type { AppLanguage, AppSettings, AppearanceSettings, SeriesColorSettings } from './app-settings';
import { THEME_MODES, isAppLanguage } from './app-settings';
import { isProjectionMethod, type ProjectionMethod } from '../usage/projection-method';
import { normalizeQuartiles, type UsageAlertSettings } from '../usage/usage-alerts';
import { normalizeUsageBlocks, type UsageBlockSettings } from '../usage/usage-blocks';
import {
  isUuid,
  normalizeActiveAccountId,
  normalizeClientId,
  readStrictClaudeAccounts,
  type ClaudeClientIdMode,
  type ClaudeSettings,
} from './claude-accounts';
import { isHexColor } from './hex-color';
import type { PageId } from './page-id';

export interface SettingsPatch {
  enabledPages?: Record<PageId, boolean>;
  appearance?: Partial<AppearanceSettings>;
  language?: AppLanguage;
  projectionMethod?: ProjectionMethod;
  seriesColors?: Partial<SeriesColorSettings>;
  usageAlerts?: Partial<UsageAlertSettings>;
  usageBlocks?: Partial<UsageBlockSettings>;
  claude?: Partial<ClaudeSettings>;
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
  if (first.usageAlerts !== undefined || second.usageAlerts !== undefined) {
    merged.usageAlerts = { ...first.usageAlerts, ...second.usageAlerts };
  }
  if (first.usageBlocks !== undefined || second.usageBlocks !== undefined) {
    merged.usageBlocks = { ...first.usageBlocks, ...second.usageBlocks };
  }
  if (first.claude !== undefined || second.claude !== undefined) {
    merged.claude = { ...first.claude, ...second.claude };
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

function applyUsageAlerts(current: UsageAlertSettings, patch: Partial<UsageAlertSettings>): UsageAlertSettings {
  return {
    fiveHour: Array.isArray(patch.fiveHour) ? normalizeQuartiles(patch.fiveHour) : current.fiveHour,
    sevenDay: Array.isArray(patch.sevenDay) ? normalizeQuartiles(patch.sevenDay) : current.sevenDay,
  };
}

function applyClientIdMode(current: ClaudeSettings, patch: Partial<ClaudeSettings>): ClaudeClientIdMode {
  const requested = patch.clientId === undefined ? current.clientId : normalizeClientId(patch.clientId);
  const clientId = requested ?? current.clientId;
  if (patch.useDefaultClientId === true) return { useDefaultClientId: true, clientId };
  if (patch.useDefaultClientId === false && requested !== null && isUuid(clientId)) return { useDefaultClientId: false, clientId };
  return { useDefaultClientId: current.useDefaultClientId, clientId };
}

function applyClaude(current: ClaudeSettings, patch: Partial<ClaudeSettings>): ClaudeSettings {
  const accounts = patch.accounts === undefined ? current.accounts : (readStrictClaudeAccounts(patch.accounts) ?? current.accounts);
  const wanted = patch.activeAccountId;
  const known = wanted === null || accounts.some((account) => account.id === wanted);
  const requested = wanted !== undefined && known ? wanted : current.activeAccountId;
  return {
    ...applyClientIdMode(current, patch),
    accounts,
    activeAccountId: normalizeActiveAccountId(accounts, requested),
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
    usageAlerts: applyUsageAlerts(current.usageAlerts, patch.usageAlerts ?? {}),
    usageBlocks: normalizeUsageBlocks(patch.usageBlocks, current.usageBlocks),
    claude: applyClaude(current.claude, patch.claude ?? {}),
  };
}
