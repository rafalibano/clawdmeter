import type { ProjectionMethod } from '../usage/projection-method';
import type { ClaudeSettings } from './claude-accounts';
import type { UsageAlertSettings } from '../usage/usage-alerts';
import type { UsageBlockSettings } from '../usage/usage-blocks';
import type { PageId } from './page-id';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export type AppLanguage = 'pt-BR' | 'en' | 'es-MX';

export const APP_LANGUAGES: readonly AppLanguage[] = ['en', 'pt-BR', 'es-MX'];

export const DEFAULT_LANGUAGE: AppLanguage = 'en';

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.includes(value as AppLanguage);
}

export interface SeriesColorSettings {
  fiveHour: string | null;
  sevenDay: string | null;
}

export interface AppearanceSettings {
  accentColor: string;
  popoverBackground: string | null;
  theme: ThemeMode;
}

export interface AppSettings {
  schemaVersion: number;
  enabledPages: Record<PageId, boolean>;
  appearance: AppearanceSettings;
  language: AppLanguage;
  projectionMethod: ProjectionMethod;
  seriesColors: SeriesColorSettings;
  usageAlerts: UsageAlertSettings;
  usageBlocks: UsageBlockSettings;
  claude: ClaudeSettings;
}
