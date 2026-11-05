import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings, SCHEMA_VERSION } from '../../domain/settings';
import type { JsonFile } from './json-file';
import { JsonSettingsStore } from './json-settings-store';

class MemoryFile implements JsonFile {
  writes = 0;
  private onChange: (() => void) | null = null;

  constructor(public text: string | null = null) {}

  async read(): Promise<string | null> {
    return this.text;
  }

  async write(text: string): Promise<void> {
    this.text = text;
    this.writes++;
    this.onChange?.();
  }

  async watch(onChange: () => void): Promise<() => void> {
    this.onChange = onChange;
    return () => (this.onChange = null);
  }

  editManually(text: string): void {
    this.text = text;
    this.onChange?.();
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('JsonSettingsStore', () => {
  it('cria o arquivo com os defaults quando ele não existe', async () => {
    const file = new MemoryFile();
    const settings = await new JsonSettingsStore(file).load();
    expect(settings).toEqual(createDefaultSettings());
    expect(JSON.parse(file.text ?? '')).toEqual(createDefaultSettings());
  });

  it('migra e regrava arquivo de versão antiga', async () => {
    const file = new MemoryFile(JSON.stringify({ enabledPages: { example: false } }));
    const settings = await new JsonSettingsStore(file).load();
    expect(settings.enabledPages).toEqual({ example: false });
    expect(JSON.parse(file.text ?? '').schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('não regrava arquivo já na versão atual', async () => {
    const file = new MemoryFile(`${JSON.stringify(createDefaultSettings())}\n`);
    await new JsonSettingsStore(file).load();
    expect(file.writes).toBe(0);
  });

  it('cai nos defaults com JSON corrompido', async () => {
    const file = new MemoryFile('{ nao eh json');
    expect(await new JsonSettingsStore(file).load()).toEqual(createDefaultSettings());
  });

  it('persiste e relê o que foi salvo', async () => {
    const file = new MemoryFile();
    const store = new JsonSettingsStore(file);
    const next = { ...createDefaultSettings(), enabledPages: { example: false } };
    await store.save(next);
    expect(await store.load()).toEqual(next);
  });

  it('recarrega edição manual do arquivo', async () => {
    const file = new MemoryFile(`${JSON.stringify(createDefaultSettings())}\n`);
    const store = new JsonSettingsStore(file);
    const listener = vi.fn();
    await store.watch(listener);
    file.editManually(JSON.stringify({ schemaVersion: SCHEMA_VERSION, appearance: { theme: 'dark' } }));
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].appearance.theme).toBe('dark');
  });

  it('ignora o eco da própria gravação', async () => {
    const file = new MemoryFile();
    const store = new JsonSettingsStore(file);
    const listener = vi.fn();
    await store.watch(listener);
    await store.save(createDefaultSettings());
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignora edição manual ainda inválida', async () => {
    const file = new MemoryFile();
    const store = new JsonSettingsStore(file);
    const listener = vi.fn();
    await store.watch(listener);
    file.editManually('{ "appearance": ');
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('para de notificar depois de cancelar', async () => {
    const file = new MemoryFile();
    const store = new JsonSettingsStore(file);
    const listener = vi.fn();
    const stop = await store.watch(listener);
    stop();
    file.editManually('{}');
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });
});
