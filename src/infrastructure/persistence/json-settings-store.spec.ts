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
  it('creates the file with the defaults when it does not exist', async () => {
    const file = new MemoryFile();
    const settings = await new JsonSettingsStore(file).load();
    expect(settings).toEqual(createDefaultSettings());
    expect(JSON.parse(file.text ?? '')).toEqual(createDefaultSettings());
  });

  it('migrates and rewrites a file of an old version', async () => {
    const file = new MemoryFile(JSON.stringify({ enabledPages: { example: false } }));
    const settings = await new JsonSettingsStore(file).load();
    expect(settings.enabledPages).toMatchObject({ example: false });
    expect(JSON.parse(file.text ?? '').schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('rewrites the F1 file with the old indigo already in Mottu green', async () => {
    const file = new MemoryFile(JSON.stringify({ schemaVersion: 1, enabledPages: {}, appearance: { accentColor: '#6366f1', popoverBackground: null, theme: 'system' } }));
    const settings = await new JsonSettingsStore(file).load();
    expect(settings.appearance.accentColor).toBe('#00b131');
    expect(JSON.parse(file.text ?? '')).toMatchObject({ schemaVersion: SCHEMA_VERSION, appearance: { accentColor: '#00b131' } });
  });

  it('does not rewrite a file already at the current version', async () => {
    const file = new MemoryFile(`${JSON.stringify(createDefaultSettings())}\n`);
    await new JsonSettingsStore(file).load();
    expect(file.writes).toBe(0);
  });

  it('falls back to the defaults with corrupt JSON', async () => {
    const file = new MemoryFile('{ nao eh json');
    expect(await new JsonSettingsStore(file).load()).toEqual(createDefaultSettings());
  });

  it('invalid JSON is not overwritten', async () => {
    const broken = '{ "appearance": { "theme": "dark" ';
    const file = new MemoryFile(broken);
    const store = new JsonSettingsStore(file);
    await store.load();
    expect(file.text).toBe(broken);
    expect(file.writes).toBe(0);
  });

  it('invalid JSON is not overwritten even after an update', async () => {
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

  it('an update with an invalid file builds on the last valid in-memory state', async () => {
    const valid = { ...createDefaultSettings(), appearance: { ...createDefaultSettings().appearance, theme: 'dark' as const } };
    const file = new MemoryFile(`${JSON.stringify(valid)}\n`);
    const store = new JsonSettingsStore(file);
    await store.load();
    file.text = '{ quebrado';
    await expect(new UpdateSettings(store).execute({ enabledPages: { example: false } })).rejects.toBeInstanceOf(
      SettingsWriteBlockedError,
    );
    expect((await store.load()).appearance.theme).toBe('dark');
    expect((await store.load()).enabledPages).toMatchObject({ example: false });
    expect(file.text).toBe('{ quebrado');
  });

  it('writes again after the file is fixed', async () => {
    const file = new MemoryFile('{ quebrado');
    const store = new JsonSettingsStore(file);
    await store.load();
    file.text = JSON.stringify(createDefaultSettings());
    await store.save({ ...createDefaultSettings(), enabledPages: { example: false } });
    expect(JSON.parse(file.text).enabledPages).toMatchObject({ example: false });
  });

  it('valid JSON that is not an object is not overwritten either', async () => {
    const file = new MemoryFile('[1, 2]');
    await new JsonSettingsStore(file).load();
    expect(file.text).toBe('[1, 2]');
  });

  it('does not downgrade a file with a future version', async () => {
    const future = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, appearance: { theme: 'dark' }, novo: true })}\n`;
    const file = new MemoryFile(future);
    const settings = await new JsonSettingsStore(file).load();
    expect(settings.appearance.theme).toBe('dark');
    expect(file.writes).toBe(0);
    expect(file.text).toBe(future);
  });

  it('exposes invalid status on load and goes back to ok after being fixed and written', async () => {
    const file = new MemoryFile('{ quebrado');
    const store = new JsonSettingsStore(file);
    await store.load();
    expect(store.status()).toBe('invalid');
    file.text = JSON.stringify(createDefaultSettings());
    await store.save(createDefaultSettings());
    expect(store.status()).toBe('ok');
  });

  it('refuses to write over a future-version file and signals future', async () => {
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

  it('status follows manual edits observed by watch', async () => {
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

  it('prunes expired echoes on write too', async () => {
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

  it('persists and rereads what was saved', async () => {
    const file = new MemoryFile();
    const store = new JsonSettingsStore(file);
    const next = { ...createDefaultSettings(), enabledPages: { example: false } };
    await store.save(next);
    expect(await store.load()).toEqual(next);
  });

  it('reloads a manual edit of the file', async () => {
    const file = new MemoryFile(`${JSON.stringify(createDefaultSettings())}\n`);
    const store = new JsonSettingsStore(file);
    const listener = vi.fn();
    await store.watch(listener);
    file.editManually(JSON.stringify({ schemaVersion: SCHEMA_VERSION, appearance: { theme: 'dark' } }));
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].appearance.theme).toBe('dark');
  });

  it('ignores the echo of its own write', async () => {
    const file = new MemoryFile();
    const store = new JsonSettingsStore(file);
    const listener = vi.fn();
    await store.watch(listener);
    await store.save(createDefaultSettings());
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores the late echo of a write when the next one is already in flight', async () => {
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

  it('ignores the late echo of the previous write after the next one finished', async () => {
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

  it('forwards a manual edit after the echo window expires', async () => {
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

  it('ignores a manual edit that is still invalid', async () => {
    const file = new MemoryFile();
    const store = new JsonSettingsStore(file);
    const listener = vi.fn();
    await store.watch(listener);
    file.editManually('{ "appearance": ');
    await tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after cancelling', async () => {
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
