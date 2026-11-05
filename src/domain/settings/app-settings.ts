import type { PageId } from './page-id';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export type AppLanguage = 'pt-BR' | 'en' | 'es-MX';

export const APP_LANGUAGES: readonly AppLanguage[] = ['pt-BR', 'en', 'es-MX'];

export const DEFAULT_LANGUAGE: AppLanguage = 'pt-BR';

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.includes(value as AppLanguage);
}

export interface UsageThresholds {
  warning: number;
  critical: number;
}

export const DEFAULT_USAGE_THRESHOLDS: UsageThresholds = { warning: 70, critical: 90 };

export function isValidUsageThresholds(value: { warning: unknown; critical: unknown }): value is UsageThresholds {
  const { warning, critical } = value;
  return (
    typeof warning === 'number' &&
    typeof critical === 'number' &&
    Number.isFinite(warning) &&
    Number.isFinite(critical) &&
    warning > 0 &&
    warning < critical &&
    critical <= 100
  );
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
  usageThresholds: UsageThresholds;
}
