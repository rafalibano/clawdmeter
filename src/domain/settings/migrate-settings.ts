import type { AppSettings, ThemeMode } from './app-settings';
import { THEME_MODES } from './app-settings';
import { createDefaultSettings } from './defaults';
import { isHexColor } from './hex-color';
import { SCHEMA_VERSION } from './schema-version';

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: readonly Migration[] = [(raw) => ({ ...raw })];

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
