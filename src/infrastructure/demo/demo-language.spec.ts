import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../../domain/settings';
import { DEMO_SETTINGS_KEY, applyDemoLanguage } from './demo-language';

function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[DEMO_SETTINGS_KEY, initial]]);
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe('?lang= no demo', () => {
  it('grava o idioma pedido sem perder o resto dos ajustes', () => {
    const storage = memory(JSON.stringify({ schemaVersion: 3, appearance: { theme: 'dark' } }));
    applyDemoLanguage('?demo=usage:high&lang=en', storage);
    const settings = migrateSettings(JSON.parse(storage.data.get(DEMO_SETTINGS_KEY)!));
    expect(settings.language).toBe('en');
    expect(settings.appearance.theme).toBe('dark');
  });

  it('idioma inválido ou ausente não mexe no armazenamento', () => {
    const storage = memory();
    applyDemoLanguage('?lang=fr', storage);
    applyDemoLanguage('', storage);
    expect(storage.data.size).toBe(0);
  });

  it('JSON corrompido é substituído só pelo idioma', () => {
    const storage = memory('{nope');
    applyDemoLanguage('?lang=es-MX', storage);
    expect(JSON.parse(storage.data.get(DEMO_SETTINGS_KEY)!)).toEqual({ language: 'es-MX' });
  });
});
