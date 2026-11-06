import { describe, expect, it } from 'vitest';
import { createDefaultSettings, type AppSettings } from '../../domain/settings';
import { FakeSettingsStore } from '../testing/fake-settings-store';
import { GetSettings, GetSettingsStatus, UpdateSettings, WatchSettings } from '../use-cases';
import { SettingsSession, type SettingsSessionDeps, type SettingsSessionState } from './settings-session';

function depsFor(store: FakeSettingsStore): SettingsSessionDeps {
  return {
    getSettings: new GetSettings(store),
    getSettingsStatus: new GetSettingsStatus(store),
    updateSettings: new UpdateSettings(store),
    watchSettings: new WatchSettings(store),
  };
}

function setup(store = new FakeSettingsStore()) {
  const states: SettingsSessionState[] = [];
  const session = new SettingsSession(depsFor(store), (state) => states.push(state));
  return { store, states, session };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('SettingsSession', () => {
  it('loads and becomes ready', async () => {
    const persisted = { ...createDefaultSettings(), enabledPages: { a: false } };
    const { session } = setup(new FakeSettingsStore(persisted));
    expect(session.current.ready).toBe(false);
    await session.start();
    expect(session.current).toEqual({ settings: persisted, ready: true, error: null });
  });

  it('applies the patch right away and persists the result', async () => {
    const { session, store } = setup();
    await session.start();
    session.update({ appearance: { theme: 'dark' } });
    expect(session.current.settings.appearance.theme).toBe('dark');
    expect(store.saved).toHaveLength(0);
    await session.idle();
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.appearance.theme).toBe('dark');
  });

  it('merges patches made during an in-flight write into a single following write', async () => {
    const store = new FakeSettingsStore();
    const release: Array<() => void> = [];
    const originalSave = store.save.bind(store);
    store.save = (settings: AppSettings) => new Promise<void>((resolve) => release.push(() => void originalSave(settings).then(resolve)));
    const { session } = setup(store);
    await session.start();
    session.update({ enabledPages: { a: false } });
    await delay(0);
    session.update({ enabledPages: { b: false } });
    session.update({ enabledPages: { a: true }, appearance: { theme: 'light' } });
    expect(release).toHaveLength(1);
    release[0]?.();
    await delay(0);
    expect(release).toHaveLength(2);
    release[1]?.();
    await session.idle();
    expect(store.saved).toHaveLength(2);
    expect(store.saved[1]?.enabledPages).toMatchObject({ a: true, b: false });
    expect(store.saved[1]?.appearance.theme).toBe('light');
    expect(session.current.settings).toEqual(store.saved[1]);
  });

  it('the last patch wins over the previous ones on the same field', async () => {
    const { session, store } = setup();
    await session.start();
    session.update({ appearance: { accentColor: '#111111' } });
    session.update({ appearance: { accentColor: '#222222' } });
    await session.idle();
    expect(store.saved.at(-1)?.appearance.accentColor).toBe('#222222');
    expect(session.current.settings.appearance.accentColor).toBe('#222222');
  });

  it('applies an external change when idle', async () => {
    const { session, store } = setup();
    await session.start();
    const external = { ...createDefaultSettings(), enabledPages: { x: false } };
    store.emitExternalChange(external);
    expect(session.current.settings).toEqual(external);
  });

  it('ignores an external change while a write is pending', async () => {
    const { session, store } = setup();
    await session.start();
    session.update({ appearance: { accentColor: '#222222' } });
    store.emitExternalChange({ ...createDefaultSettings(), appearance: { ...createDefaultSettings().appearance, accentColor: '#111111' } });
    expect(session.current.settings.appearance.accentColor).toBe('#222222');
    await session.idle();
    expect(session.current.settings.appearance.accentColor).toBe('#222222');
  });

  it('falls back to the defaults with a visible error when the read fails', async () => {
    const store = new FakeSettingsStore();
    store.load = () => Promise.reject(new Error('disco'));
    const { session } = setup(store);
    await session.start();
    expect(session.current).toEqual({ settings: createDefaultSettings(), ready: true, error: 'load' });
  });

  it('keeps the optimistic state and flags an error when the write fails', async () => {
    const store = new FakeSettingsStore();
    const { session } = setup(store);
    await session.start();
    store.save = () => Promise.reject(new Error('somente leitura'));
    session.update({ appearance: { theme: 'dark' } });
    await session.idle();
    expect(session.current.settings.appearance.theme).toBe('dark');
    expect(session.current.error).toBe('save');
  });

  it('clears the write error after a successful write', async () => {
    const store = new FakeSettingsStore();
    const originalSave = store.save.bind(store);
    const { session } = setup(store);
    await session.start();
    store.save = () => Promise.reject(new Error('x'));
    session.update({ appearance: { theme: 'dark' } });
    await session.idle();
    store.save = originalSave;
    session.update({ appearance: { theme: 'light' } });
    await session.idle();
    expect(session.current.error).toBeNull();
  });

  it('flags an error when it cannot watch the file', async () => {
    const store = new FakeSettingsStore();
    store.watch = () => Promise.reject(new Error('no watcher'));
    const { session } = setup(store);
    await session.start();
    expect(session.current.ready).toBe(true);
    expect(session.current.error).toBe('watch');
  });

  it('a successful flush clears only the write error and keeps watch', async () => {
    const store = new FakeSettingsStore();
    store.watch = () => Promise.reject(new Error('no watcher'));
    const { session } = setup(store);
    await session.start();
    expect(session.current.error).toBe('watch');
    session.update({ appearance: { theme: 'dark' } });
    await session.idle();
    expect(session.current.error).toBe('watch');
  });

  it('keeps the load error after a successful write', async () => {
    const store = new FakeSettingsStore();
    const originalLoad = store.load.bind(store);
    store.load = () => Promise.reject(new Error('unreadable'));
    const { session } = setup(store);
    await session.start();
    store.load = originalLoad;
    session.update({ appearance: { theme: 'dark' } });
    await session.idle();
    expect(session.current.error).toBe('load');
  });

  it('exposes an invalid settings.json at start and when trying to write', async () => {
    const store = new FakeSettingsStore();
    store.fileStatus = 'invalid';
    const { session } = setup(store);
    await session.start();
    expect(session.current.error).toBe('invalid');
    session.update({ appearance: { theme: 'dark' } });
    await session.idle();
    expect(session.current.error).toBe('invalid');
    expect(store.saved).toHaveLength(0);
  });

  it('exposes a future version when the write fails and clears when the file becomes valid again', async () => {
    const store = new FakeSettingsStore();
    const { session } = setup(store);
    await session.start();
    expect(session.current.error).toBeNull();
    store.fileStatus = 'future';
    session.update({ appearance: { theme: 'dark' } });
    await session.idle();
    expect(session.current.error).toBe('future');
    store.fileStatus = 'ok';
    store.emitExternalChange(createDefaultSettings());
    expect(session.current.error).toBeNull();
  });

  it('dispose cancels the watch', async () => {
    const { session, store } = setup();
    await session.start();
    session.dispose();
    store.emitExternalChange({ ...createDefaultSettings(), enabledPages: { x: false } });
    expect(session.current.settings.enabledPages).toEqual({ teams: false, skills: false });
  });
});

describe('SettingsSession and the Claude accounts written by the use cases', () => {
  const ACCOUNTS = { accounts: [{ id: 'a1', name: 'Personal' }], activeAccountId: 'a1' };

  it('adopts the Claude section saved through the shared UpdateSettings', async () => {
    const store = new FakeSettingsStore();
    const deps = depsFor(store);
    const session = new SettingsSession(deps, () => undefined);
    await session.start();
    await deps.updateSettings.execute({ claude: ACCOUNTS });
    expect(session.current.settings.claude).toMatchObject(ACCOUNTS);
  });

  it('a pending write of the session does not bring back an older Claude section', async () => {
    const store = new FakeSettingsStore();
    const release: Array<() => void> = [];
    const originalSave = store.save.bind(store);
    store.save = (settings: AppSettings) => new Promise<void>((resolve) => release.push(() => void originalSave(settings).then(resolve)));
    const deps = depsFor(store);
    const session = new SettingsSession(deps, () => undefined);
    await session.start();
    session.update({ appearance: { theme: 'dark' } });
    const accounts = deps.updateSettings.execute({ claude: ACCOUNTS });
    await delay(0);
    release[0]?.();
    await delay(0);
    release[1]?.();
    await accounts;
    await session.idle();
    expect(session.current.settings.appearance.theme).toBe('dark');
    expect(session.current.settings.claude).toMatchObject(ACCOUNTS);
    expect(store.saved.at(-1)?.claude).toMatchObject(ACCOUNTS);
    expect(store.saved.at(-1)?.appearance.theme).toBe('dark');
  });

  it('a Claude write that lands between two batches of the session survives the end of the flush', async () => {
    const store = new FakeSettingsStore();
    const release: Array<() => void> = [];
    const originalSave = store.save.bind(store);
    store.save = (settings: AppSettings) => new Promise<void>((resolve) => release.push(() => void originalSave(settings).then(resolve)));
    const deps = depsFor(store);
    const states: SettingsSessionState[] = [];
    const session = new SettingsSession(deps, (state) => states.push(state));
    await session.start();
    session.update({ appearance: { theme: 'dark' } });
    await delay(0);
    session.update({ language: 'pt-BR' });
    const accounts = deps.updateSettings.execute({ claude: ACCOUNTS });
    for (let index = 0; index < 3; index++) {
      await delay(0);
      release[index]?.();
    }
    await accounts;
    await session.idle();
    expect(release).toHaveLength(3);
    expect(states.at(-1)?.settings).toMatchObject({ language: 'pt-BR', appearance: { theme: 'dark' }, claude: ACCOUNTS });
    expect(store.saved.at(-1)).toMatchObject({ language: 'pt-BR', claude: ACCOUNTS });
  });

  it('stops adopting after dispose', async () => {
    const store = new FakeSettingsStore();
    const deps = depsFor(store);
    const session = new SettingsSession(deps, () => undefined);
    await session.start();
    session.dispose();
    await deps.updateSettings.execute({ claude: ACCOUNTS });
    expect(session.current.settings.claude.accounts).toEqual([]);
  });
});

describe('UpdateSettings', () => {
  it('serializes writes so a change computed from the current settings sees the previous write', async () => {
    const store = new FakeSettingsStore();
    const update = new UpdateSettings(store);
    const first = update.execute({ claude: { accounts: [{ id: 'a1', name: 'Personal' }] } });
    const second = update.execute((current) => ({
      claude: { accounts: [...current.claude.accounts, { id: 'a2', name: 'Work' }] },
    }));
    await Promise.all([first, second]);
    expect(store.saved.at(-1)?.claude.accounts.map((account) => account.id)).toEqual(['a1', 'a2']);
  });

  it('a change that throws writes nothing and does not block the next one', async () => {
    const store = new FakeSettingsStore();
    const update = new UpdateSettings(store);
    const seen: AppSettings[] = [];
    update.subscribe((settings) => seen.push(settings));
    await expect(
      update.execute(() => {
        throw new Error('invalid');
      }),
    ).rejects.toThrow('invalid');
    await update.execute({ language: 'pt-BR' });
    expect(store.saved).toHaveLength(1);
    expect(seen.map((settings) => settings.language)).toEqual(['pt-BR']);
  });

  it('a listener that throws neither fails the saved write nor keeps the other listeners from hearing it', async () => {
    const store = new FakeSettingsStore();
    const update = new UpdateSettings(store);
    const seen: string[] = [];
    update.subscribe(() => {
      throw new Error('listener broke');
    });
    update.subscribe((settings) => seen.push(settings.language));
    await expect(update.execute({ language: 'pt-BR' })).resolves.toMatchObject({ language: 'pt-BR' });
    expect(store.saved).toHaveLength(1);
    expect(seen).toEqual(['pt-BR']);
  });
});

