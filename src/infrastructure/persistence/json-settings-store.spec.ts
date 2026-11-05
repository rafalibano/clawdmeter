import { describe, expect, it, vi } from 'vitest';
import { SettingsWriteBlockedError } from '../../application/ports';
import { UpdateSettings } from '../../application/use-cases';
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

class SlowFile implements JsonFile {
  text: string | null = null;
  private onChange: (() => void) | null = null;

  async read(): Promise<string | null> {
    return this.text;
  }

  async write(text: string): Promise<void> {
    await delay(30);
    this.text = text;
  }

  async watch(onChange: () => void): Promise<() => void> {
    this.onChange = onChange;
    return () => (this.onChange = null);
  }

  echo(): void {
    this.onChange?.();
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  it('JSON inválido não é sobrescrito', async () => {
    const broken = '{ "appearance": { "theme": "dark" ';
    const file = new MemoryFile(broken);
    const store = new JsonSettingsStore(file);
    await store.load();
    expect(file.text).toBe(broken);
    expect(file.writes).toBe(0);
  });

  it('JSON inválido não é sobrescrito nem após um update', async () => {
    const broken = '{ "appearance": { "theme": "dark" ';
    const file = new MemoryFile(broken);
    const store = new JsonSettingsStore(file);
    await expect(new UpdateSettings(store).execute({ appearance: { theme: 'light' } })).rejects.toBeInstanceOf(
      SettingsWriteBlockedError,
    );
    await expect(new UpdateSettings(store).execute({ enabledPages: { example: false } })).rejects.toMatchObject({
      reason: 'invalid',
    });
    expect(store.status()).toBe('invalid');
    expect(file.text).toBe(broken);
    expect(file.writes).toBe(0);
  });

  it('update com arquivo inválido acumula sobre o último estado válido em memória', async () => {
    const valid = { ...createDefaultSettings(), appearance: { ...createDefaultSettings().appearance, theme: 'dark' as const } };
    const file = new MemoryFile(`${JSON.stringify(valid)}\n`);
    const store = new JsonSettingsStore(file);
    await store.load();
    file.text = '{ quebrado';
    await expect(new UpdateSettings(store).execute({ enabledPages: { example: false } })).rejects.toBeInstanceOf(
      SettingsWriteBlockedError,
    );
    expect((await store.load()).appearance.theme).toBe('dark');
    expect((await store.load()).enabledPages).toEqual({ example: false });
    expect(file.text).toBe('{ quebrado');
  });

  it('volta a gravar depois que o arquivo é corrigido', async () => {
    const file = new MemoryFile('{ quebrado');
    const store = new JsonSettingsStore(file);
    await store.load();
    file.text = JSON.stringify(createDefaultSettings());
    await store.save({ ...createDefaultSettings(), enabledPages: { example: false } });
    expect(JSON.parse(file.text).enabledPages).toEqual({ example: false });
  });

  it('JSON válido que não é objeto também não é sobrescrito', async () => {
    const file = new MemoryFile('[1, 2]');
    await new JsonSettingsStore(file).load();
    expect(file.text).toBe('[1, 2]');
  });

  it('não faz downgrade de arquivo com versão futura', async () => {
    const future = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, appearance: { theme: 'dark' }, novo: true })}\n`;
    const file = new MemoryFile(future);
    const settings = await new JsonSettingsStore(file).load();
    expect(settings.appearance.theme).toBe('dark');
    expect(file.writes).toBe(0);
    expect(file.text).toBe(future);
  });

  it('expõe status invalid no load e volta a ok depois de corrigido e gravado', async () => {
    const file = new MemoryFile('{ quebrado');
    const store = new JsonSettingsStore(file);
    await store.load();
    expect(store.status()).toBe('invalid');
    file.text = JSON.stringify(createDefaultSettings());
    await store.save(createDefaultSettings());
    expect(store.status()).toBe('ok');
  });

  it('recusa gravar sobre arquivo de versão futura e sinaliza future', async () => {
    const future = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, appearance: { theme: 'dark' }, novo: true })}\n`;
    const file = new MemoryFile(future);
    const store = new JsonSettingsStore(file);
    await store.load();
    expect(store.status()).toBe('future');
    await expect(store.save({ ...createDefaultSettings(), enabledPages: { example: false } })).rejects.toMatchObject({
      reason: 'future',
    });
    expect(file.writes).toBe(0);
    expect(file.text).toBe(future);
  });

  it('status acompanha edição manual observada pelo watch', async () => {
    const file = new MemoryFile(`${JSON.stringify(createDefaultSettings())}\n`);
    const store = new JsonSettingsStore(file);
    await store.load();
    await store.watch(vi.fn());
    file.editManually('{ "x": ');
    await tick();
    expect(store.status()).toBe('invalid');
    file.editManually(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }));
    await tick();
    expect(store.status()).toBe('future');
    file.editManually(JSON.stringify(createDefaultSettings()));
    await tick();
    expect(store.status()).toBe('ok');
  });

  it('poda ecos vencidos também ao gravar', async () => {
    let now = 0;
    const file = new MemoryFile();
    const store = new JsonSettingsStore(file, { echoWindowMs: 100, now: () => now });
    const first = { ...createDefaultSettings(), enabledPages: { a: false } };
    await store.save(first);
    now = 1_000;
    await store.save({ ...createDefaultSettings(), enabledPages: { b: false } });
    const writes = (store as unknown as { recentWrites: Map<string, number> }).recentWrites;
    expect(writes.size).toBe(1);
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

  it('ignora o eco atrasado de uma gravação quando a seguinte já está em voo', async () => {
    const file = new SlowFile();
    const store = new JsonSettingsStore(file, { echoWindowMs: 500 });
    const listener = vi.fn();
    await store.watch(listener);
    const first = { ...createDefaultSettings(), appearance: { ...createDefaultSettings().appearance, accentColor: '#111111' } };
    const second = { ...createDefaultSettings(), appearance: { ...createDefaultSettings().appearance, accentColor: '#222222' } };
    await store.save(first);
    const secondWrite = store.save(second);
    await delay(15);
    file.echo();
    await secondWrite;
    await delay(15);
    file.echo();
    await delay(20);
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignora o eco atrasado da gravação anterior depois que a seguinte terminou', async () => {
    const file = new SlowFile();
    const store = new JsonSettingsStore(file, { echoWindowMs: 500 });
    const listener = vi.fn();
    await store.watch(listener);
    const base = createDefaultSettings();
    await store.save({ ...base, appearance: { ...base.appearance, accentColor: '#111111' } });
    await store.save({ ...base, appearance: { ...base.appearance, accentColor: '#222222' } });
    file.echo();
    file.echo();
    await delay(20);
    expect(listener).not.toHaveBeenCalled();
  });

  it('repassa edição manual depois que a janela de eco expira', async () => {
    let now = 0;
    const file = new MemoryFile();
    const store = new JsonSettingsStore(file, { echoWindowMs: 100, now: () => now });
    const listener = vi.fn();
    await store.watch(listener);
    await store.save(createDefaultSettings());
    now = 1_000;
    file.editManually(file.text ?? '');
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
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
