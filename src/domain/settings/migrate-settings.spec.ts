import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from './defaults';
import { migrateSettings, type Migration } from './migrate-settings';
import { isPageEnabled } from './page-enabled';
import { SCHEMA_VERSION } from './schema-version';

describe('defaults', () => {
  it('starts at the current version, with the system theme and no explicit pages', () => {
    const defaults = createDefaultSettings();
    expect(defaults.schemaVersion).toBe(SCHEMA_VERSION);
    expect(defaults.enabledPages).toEqual({ teams: false, skills: false });
    expect(defaults.appearance.theme).toBe('system');
    expect(defaults.appearance.popoverBackground).toBeNull();
  });

  it('returns independent objects', () => {
    expect(createDefaultSettings()).not.toBe(createDefaultSettings());
  });

  it('defaults to English', () => {
    expect(createDefaultSettings().language).toBe('en');
  });
});

describe('migrateSettings', () => {
  it('returns defaults when the content is not an object', () => {
    expect(migrateSettings(null)).toEqual(createDefaultSettings());
    expect(migrateSettings('texto')).toEqual(createDefaultSettings());
    expect(migrateSettings([1, 2])).toEqual(createDefaultSettings());
  });

  it('adopts the current format for a file without a version', () => {
    const migrated = migrateSettings({ enabledPages: { example: false }, appearance: { theme: 'dark' } });
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.enabledPages).toMatchObject({ example: false });
    expect(migrated.appearance.theme).toBe('dark');
    expect(migrated.appearance.accentColor).toBe(createDefaultSettings().appearance.accentColor);
  });

  it('keeps a valid file at the current version', () => {
    const current = {
      schemaVersion: SCHEMA_VERSION,
      enabledPages: { example: true },
      appearance: { accentColor: '#22C55E', popoverBackground: '#101010', theme: 'light' },
      language: 'es-MX',
      projectionMethod: 'since-reset',
      seriesColors: { fiveHour: '#0063F7', sevenDay: null },
    };
    expect(migrateSettings(current)).toEqual({
      ...current,
      appearance: { accentColor: '#22c55e', popoverBackground: '#101010', theme: 'light' },
      seriesColors: { fiveHour: '#0063f7', sevenDay: null },
    });
  });

  it('drops invalid values and falls back to the field defaults', () => {
    const migrated = migrateSettings({
      schemaVersion: SCHEMA_VERSION,
      enabledPages: { a: 'sim', b: true },
      appearance: { accentColor: 'vermelho', popoverBackground: '#12', theme: 'neon' },
    });
    expect(migrated.enabledPages).toMatchObject({ b: true });
    expect(migrated.appearance).toEqual(createDefaultSettings().appearance);
  });

  it('chains the migrations from the file version to the target version', () => {
    const toOne: Migration = (raw) => ({ ...raw, enabledPages: raw['pages'] });
    const toTwo: Migration = (raw) => ({ ...raw, appearance: { theme: 'dark' } });
    const migrated = migrateSettings({ pages: { example: false } }, [toOne, toTwo], 2);
    expect(migrated.enabledPages).toMatchObject({ example: false });
    expect(migrated.appearance.theme).toBe('dark');
  });

  it('replaces the old indigo accent with the Mottu green, on version 0 or 1', () => {
    for (const schemaVersion of [undefined, 1]) {
      const migrated = migrateSettings({ schemaVersion, appearance: { accentColor: '#6366F1', theme: 'dark' } });
      expect(migrated.appearance.accentColor).toBe('#00b131');
      expect(migrated.appearance.theme).toBe('dark');
      expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });

  it('preserves a chosen accent and leaves the indigo of a file already at the current version alone', () => {
    expect(migrateSettings({ schemaVersion: 1, appearance: { accentColor: '#ff0000' } }).appearance.accentColor).toBe('#ff0000');
    expect(migrateSettings({ schemaVersion: SCHEMA_VERSION, appearance: { accentColor: '#6366f1' } }).appearance.accentColor).toBe('#6366f1');
  });

  it('the default accent is the Mottu green', () => {
    expect(createDefaultSettings().appearance.accentColor).toBe('#00b131');
  });

  it('file from version 2 without language gets en', () => {
    const migrated = migrateSettings({ schemaVersion: 2, enabledPages: { usage: true }, appearance: { theme: 'dark' } });
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.language).toBe('en');
    expect(migrated).not.toHaveProperty('usageThresholds');
    expect(migrated.appearance.theme).toBe('dark');
  });

  it('known language is preserved; unknown falls back to en', () => {
    expect(migrateSettings({ schemaVersion: 2, language: 'pt-BR' }).language).toBe('pt-BR');
    expect(migrateSettings({ schemaVersion: 3, language: 'es-MX' }).language).toBe('es-MX');
    expect(migrateSettings({ schemaVersion: 3, language: 'fr' }).language).toBe('en');
    expect(migrateSettings({ schemaVersion: 3, language: 42 }).language).toBe('en');
  });

  it('version 4 with thresholds drops the field', () => {
    const migrated = migrateSettings({ schemaVersion: 4, usageThresholds: { warning: 60, critical: 85 } });
    expect(migrated).not.toHaveProperty('usageThresholds');
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('only runs the pending migrations', () => {
    const calls: number[] = [];
    const toOne: Migration = (raw) => (calls.push(1), raw);
    const toTwo: Migration = (raw) => (calls.push(2), raw);
    migrateSettings({ schemaVersion: 1 }, [toOne, toTwo], 2);
    expect(calls).toEqual([2]);
  });

  it('does not alter a future-version file beyond normalizing', () => {
    const migrated = migrateSettings({ schemaVersion: SCHEMA_VERSION + 5, enabledPages: { example: false } });
    expect(migrated.enabledPages).toMatchObject({ example: false });
  });
});

describe('migration 3 -> 4 (pages under maintenance)', () => {
  it('turns off Skills and Agenda for those who had them on or had no preference', () => {
    expect(migrateSettings({ schemaVersion: 3, enabledPages: { teams: true, usage: false } }).enabledPages).toEqual({
      teams: false,
      skills: false,
      usage: false,
    });
    expect(migrateSettings({ schemaVersion: 3 }).enabledPages).toEqual({ teams: false, skills: false });
  });

  it('only acts once: turning them back on later is respected', () => {
    const current = migrateSettings({ schemaVersion: 4, enabledPages: { teams: true, skills: false } });
    expect(current.enabledPages).toEqual({ teams: true, skills: false });
    expect(current.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('the default for new settings already has both turned off', () => {
    expect(createDefaultSettings().enabledPages).toEqual({ teams: false, skills: false });
    expect(isPageEnabled(createDefaultSettings(), 'teams')).toBe(false);
    expect(isPageEnabled(createDefaultSettings(), 'usage')).toBe(true);
  });
});

describe('migration 5 -> 6 (projection method)', () => {
  it('file from version 5 gets the current default projection (7d)', () => {
    const migrated = migrateSettings({ schemaVersion: 5, language: 'en', appearance: { theme: 'dark' } });
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.projectionMethod).toBe('7d');
    expect(migrated.language).toBe('en');
  });

  it('preserves a valid method and replaces an invalid one with the default', () => {
    expect(migrateSettings({ schemaVersion: 5, projectionMethod: 'since-reset' }).projectionMethod).toBe('since-reset');
    expect(migrateSettings({ schemaVersion: 6, projectionMethod: 'since-reset' }).projectionMethod).toBe('since-reset');
    expect(migrateSettings({ schemaVersion: 6, projectionMethod: '24h' }).projectionMethod).toBe('24h');
    expect(migrateSettings({ schemaVersion: 6, projectionMethod: 'regressao' }).projectionMethod).toBe('7d');
    expect(migrateSettings({ schemaVersion: 6, projectionMethod: 'sinceReset' }).projectionMethod).toBe('7d');
    expect(migrateSettings({ schemaVersion: 6 }).projectionMethod).toBe('7d');
  });

  it('the defaults use 7d', () => {
    expect(createDefaultSettings().projectionMethod).toBe('7d');
  });
});

describe('migration 6 -> 7 (series colors)', () => {
  it('file from version 6 gets the default 5h and 7d colors', () => {
    const migrated = migrateSettings({ schemaVersion: 6, projectionMethod: '24h', appearance: { accentColor: '#0063f7' } });
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.seriesColors).toEqual({ fiveHour: null, sevenDay: null });
    expect(migrated.projectionMethod).toBe('24h');
    expect(migrated.appearance.accentColor).toBe('#0063f7');
  });

  it('preserves valid hex values and drops invalid ones', () => {
    expect(migrateSettings({ schemaVersion: 6, seriesColors: { fiveHour: '#EF6800', sevenDay: 'cinza' } }).seriesColors).toEqual({
      fiveHour: '#ef6800',
      sevenDay: null,
    });
    expect(migrateSettings({ schemaVersion: 7, seriesColors: 'x' }).seriesColors).toEqual({ fiveHour: null, sevenDay: null });
  });

  it('the defaults follow the theme colors', () => {
    expect(createDefaultSettings().seriesColors).toEqual({ fiveHour: null, sevenDay: null });
  });
});

describe('migration 7 -> 8 (last 7 days becomes the default)', () => {
  it('every saved 14d becomes 7d, since the old default and an explicit choice look the same', () => {
    const migrated = migrateSettings({ schemaVersion: 7, projectionMethod: '14d', language: 'pt-BR' });
    expect(migrated.schemaVersion).toBe(8);
    expect(migrated.projectionMethod).toBe('7d');
    expect(migrated.language).toBe('pt-BR');
  });

  it('other choices are kept', () => {
    for (const method of ['24h', 'since-reset'] as const) {
      expect(migrateSettings({ schemaVersion: 7, projectionMethod: method }).projectionMethod).toBe(method);
    }
  });

  it('a 14d chosen after the migration is kept', () => {
    expect(migrateSettings({ schemaVersion: 8, projectionMethod: '14d' }).projectionMethod).toBe('14d');
  });
});
