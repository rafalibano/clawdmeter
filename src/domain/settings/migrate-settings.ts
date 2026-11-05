import type { AppSettings, ThemeMode, UsageThresholds } from './app-settings';
import { DEFAULT_LANGUAGE, DEFAULT_USAGE_THRESHOLDS, THEME_MODES, isAppLanguage, isValidUsageThresholds } from './app-settings';
import { createDefaultSettings, DEFAULT_ACCENT_COLOR } from './defaults';
import { isHexColor } from './hex-color';
import { SCHEMA_VERSION } from './schema-version';

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

export const LEGACY_ACCENT_COLOR = '#6366f1';

const adoptMottuAccent: Migration = (raw) => {
  const appearance = raw['appearance'];
  if (!isRecord(appearance)) return raw;
  const accent = appearance['accentColor'];
  if (typeof accent !== 'string' || accent.toLowerCase() !== LEGACY_ACCENT_COLOR) return raw;
  return { ...raw, appearance: { ...appearance, accentColor: DEFAULT_ACCENT_COLOR } };
};

const addLanguageAndThresholds: Migration = (raw) => ({
  ...raw,
  language: isAppLanguage(raw['language']) ? raw['language'] : DEFAULT_LANGUAGE,
  usageThresholds: raw['usageThresholds'] ?? { ...DEFAULT_USAGE_THRESHOLDS },
});

export const MIGRATIONS: readonly Migration[] = [(raw) => ({ ...raw }), adoptMottuAccent, addLanguageAndThresholds];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readVersion(raw: Record<string, unknown>): number {
  const version = raw['schemaVersion'];
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0;
}

export function isFutureSchema(raw: unknown): boolean {
  return isRecord(raw) && readVersion(raw) > SCHEMA_VERSION;
}

function readEnabledPages(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const pages: Record<string, boolean> = {};
  for (const [id, enabled] of Object.entries(value)) {
    if (typeof enabled === 'boolean') pages[id] = enabled;
  }
  return pages;
}

function readThresholds(value: unknown): UsageThresholds {
  if (isRecord(value) && isValidUsageThresholds({ warning: value['warning'], critical: value['critical'] })) {
    return { warning: value['warning'] as number, critical: value['critical'] as number };
  }
  return { ...DEFAULT_USAGE_THRESHOLDS };
}

function normalize(raw: Record<string, unknown>): AppSettings {
  const defaults = createDefaultSettings();
  const appearance = isRecord(raw['appearance']) ? raw['appearance'] : {};
  const accent = appearance['accentColor'];
  const background = appearance['popoverBackground'];
  const theme = appearance['theme'];
  return {
    schemaVersion: SCHEMA_VERSION,
    enabledPages: readEnabledPages(raw['enabledPages']),
    appearance: {
      accentColor: isHexColor(accent) ? accent.toLowerCase() : defaults.appearance.accentColor,
      popoverBackground: isHexColor(background) ? background.toLowerCase() : null,
      theme: THEME_MODES.includes(theme as ThemeMode) ? (theme as ThemeMode) : defaults.appearance.theme,
    },
    language: isAppLanguage(raw['language']) ? raw['language'] : DEFAULT_LANGUAGE,
    usageThresholds: readThresholds(raw['usageThresholds']),
  };
}

export function migrateSettings(
  raw: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): AppSettings {
  if (!isRecord(raw)) return createDefaultSettings();
  let current = raw;
  for (let version = readVersion(raw); version < target; version++) {
    const step = migrations[version];
    if (step) current = step(current);
  }
  return normalize(current);
}
