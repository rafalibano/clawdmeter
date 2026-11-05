import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from './defaults';
import { migrateSettings, type Migration } from './migrate-settings';
import { SCHEMA_VERSION } from './schema-version';

describe('defaults', () => {
  it('nasce na versão atual, com tema do sistema e sem páginas explícitas', () => {
    const defaults = createDefaultSettings();
    expect(defaults.schemaVersion).toBe(SCHEMA_VERSION);
    expect(defaults.enabledPages).toEqual({});
    expect(defaults.appearance.theme).toBe('system');
    expect(defaults.appearance.popoverBackground).toBeNull();
  });

  it('devolve objetos independentes', () => {
    expect(createDefaultSettings()).not.toBe(createDefaultSettings());
  });
});

describe('migrateSettings', () => {
  it('devolve defaults quando o conteúdo não é um objeto', () => {
    expect(migrateSettings(null)).toEqual(createDefaultSettings());
    expect(migrateSettings('texto')).toEqual(createDefaultSettings());
    expect(migrateSettings([1, 2])).toEqual(createDefaultSettings());
  });

  it('adota o formato atual em arquivo sem versão', () => {
    const migrated = migrateSettings({ enabledPages: { example: false }, appearance: { theme: 'dark' } });
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.enabledPages).toEqual({ example: false });
    expect(migrated.appearance.theme).toBe('dark');
    expect(migrated.appearance.accentColor).toBe(createDefaultSettings().appearance.accentColor);
  });

  it('mantém um arquivo válido na versão atual', () => {
    const current = {
      schemaVersion: SCHEMA_VERSION,
      enabledPages: { example: true },
      appearance: { accentColor: '#22C55E', popoverBackground: '#101010', theme: 'light' },
    };
    expect(migrateSettings(current)).toEqual({
      ...current,
      appearance: { accentColor: '#22c55e', popoverBackground: '#101010', theme: 'light' },
    });
  });

  it('descarta valores inválidos e cai nos defaults do campo', () => {
    const migrated = migrateSettings({
      schemaVersion: SCHEMA_VERSION,
      enabledPages: { a: 'sim', b: true },
      appearance: { accentColor: 'vermelho', popoverBackground: '#12', theme: 'neon' },
    });
    expect(migrated.enabledPages).toEqual({ b: true });
    expect(migrated.appearance).toEqual(createDefaultSettings().appearance);
  });

  it('encadeia as migrações da versão do arquivo até a versão alvo', () => {
    const toOne: Migration = (raw) => ({ ...raw, enabledPages: raw['pages'] });
    const toTwo: Migration = (raw) => ({ ...raw, appearance: { theme: 'dark' } });
    const migrated = migrateSettings({ pages: { example: false } }, [toOne, toTwo], 2);
    expect(migrated.enabledPages).toEqual({ example: false });
    expect(migrated.appearance.theme).toBe('dark');
  });

  it('troca o destaque índigo antigo pelo verde Mottu, em versão 0 ou 1', () => {
    for (const schemaVersion of [undefined, 1]) {
      const migrated = migrateSettings({ schemaVersion, appearance: { accentColor: '#6366F1', theme: 'dark' } });
      expect(migrated.appearance.accentColor).toBe('#00b131');
      expect(migrated.appearance.theme).toBe('dark');
      expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });

  it('preserva destaque escolhido e não mexe no índigo de um arquivo já na versão atual', () => {
    expect(migrateSettings({ schemaVersion: 1, appearance: { accentColor: '#ff0000' } }).appearance.accentColor).toBe('#ff0000');
    expect(migrateSettings({ schemaVersion: SCHEMA_VERSION, appearance: { accentColor: '#6366f1' } }).appearance.accentColor).toBe('#6366f1');
  });

  it('o destaque padrão é o verde Mottu', () => {
    expect(createDefaultSettings().appearance.accentColor).toBe('#00b131');
  });

  it('só roda as migrações pendentes', () => {
    const calls: number[] = [];
    const toOne: Migration = (raw) => (calls.push(1), raw);
    const toTwo: Migration = (raw) => (calls.push(2), raw);
    migrateSettings({ schemaVersion: 1 }, [toOne, toTwo], 2);
    expect(calls).toEqual([2]);
  });

  it('não altera arquivo de versão futura além de normalizar', () => {
    const migrated = migrateSettings({ schemaVersion: SCHEMA_VERSION + 5, enabledPages: { example: false } });
    expect(migrated.enabledPages).toEqual({ example: false });
  });
});
