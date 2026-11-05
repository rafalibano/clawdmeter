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
  it('carrega e fica pronta', async () => {
    const persisted = { ...createDefaultSettings(), enabledPages: { a: false } };
    const { session } = setup(new FakeSettingsStore(persisted));
    expect(session.current.ready).toBe(false);
    await session.start();
    expect(session.current).toEqual({ settings: persisted, ready: true, error: null });
  });

  it('aplica o patch na hora e persiste o resultado', async () => {
    const { session, store } = setup();
    await session.start();
    session.update({ appearance: { theme: 'dark' } });
    expect(session.current.settings.appearance.theme).toBe('dark');
    expect(store.saved).toHaveLength(0);
    await session.idle();
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.appearance.theme).toBe('dark');
  });

  it('funde patches feitos durante uma gravação em voo em uma única gravação seguinte', async () => {
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
    expect(store.saved[1]?.enabledPages).toEqual({ a: true, b: false });
    expect(store.saved[1]?.appearance.theme).toBe('light');
    expect(session.current.settings).toEqual(store.saved[1]);
  });

  it('o último patch vence sobre os anteriores do mesmo campo', async () => {
    const { session, store } = setup();
    await session.start();
    session.update({ appearance: { accentColor: '#111111' } });
    session.update({ appearance: { accentColor: '#222222' } });
    await session.idle();
    expect(store.saved.at(-1)?.appearance.accentColor).toBe('#222222');
    expect(session.current.settings.appearance.accentColor).toBe('#222222');
  });

  it('aplica mudança externa quando ocioso', async () => {
    const { session, store } = setup();
    await session.start();
    const external = { ...createDefaultSettings(), enabledPages: { x: false } };
    store.emitExternalChange(external);
    expect(session.current.settings).toEqual(external);
  });

  it('ignora mudança externa enquanto há gravação pendente', async () => {
    const { session, store } = setup();
    await session.start();
    session.update({ appearance: { accentColor: '#222222' } });
    store.emitExternalChange({ ...createDefaultSettings(), appearance: { ...createDefaultSettings().appearance, accentColor: '#111111' } });
    expect(session.current.settings.appearance.accentColor).toBe('#222222');
    await session.idle();
    expect(session.current.settings.appearance.accentColor).toBe('#222222');
  });

  it('cai nos defaults com erro visível quando a leitura falha', async () => {
    const store = new FakeSettingsStore();
    store.load = () => Promise.reject(new Error('disco'));
    const { session } = setup(store);
    await session.start();
    expect(session.current).toEqual({ settings: createDefaultSettings(), ready: true, error: 'load' });
  });

  it('mantém o estado otimista e sinaliza erro quando a gravação falha', async () => {
    const store = new FakeSettingsStore();
    const { session } = setup(store);
    await session.start();
    store.save = () => Promise.reject(new Error('somente leitura'));
    session.update({ appearance: { theme: 'dark' } });
    await session.idle();
    expect(session.current.settings.appearance.theme).toBe('dark');
    expect(session.current.error).toBe('save');
  });

  it('limpa o erro de gravação depois de uma gravação bem-sucedida', async () => {
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

  it('sinaliza erro quando não consegue observar o arquivo', async () => {
    const store = new FakeSettingsStore();
    store.watch = () => Promise.reject(new Error('sem watcher'));
    const { session } = setup(store);
    await session.start();
    expect(session.current.ready).toBe(true);
    expect(session.current.error).toBe('watch');
  });

  it('flush bem-sucedido limpa só o erro de gravação e mantém watch', async () => {
    const store = new FakeSettingsStore();
    store.watch = () => Promise.reject(new Error('sem watcher'));
    const { session } = setup(store);
    await session.start();
    expect(session.current.error).toBe('watch');
    session.update({ appearance: { theme: 'dark' } });
    await session.idle();
    expect(session.current.error).toBe('watch');
  });

  it('mantém o erro de load depois de uma gravação bem-sucedida', async () => {
    const store = new FakeSettingsStore();
    const originalLoad = store.load.bind(store);
    store.load = () => Promise.reject(new Error('ilegível'));
    const { session } = setup(store);
    await session.start();
    store.load = originalLoad;
    session.update({ appearance: { theme: 'dark' } });
    await session.idle();
    expect(session.current.error).toBe('load');
  });

  it('expõe settings.json inválido no start e ao tentar gravar', async () => {
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

  it('expõe versão futura ao falhar a gravação e limpa quando o arquivo volta a ser válido', async () => {
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

  it('dispose cancela a observação', async () => {
    const { session, store } = setup();
    await session.start();
    session.dispose();
    store.emitExternalChange({ ...createDefaultSettings(), enabledPages: { x: false } });
    expect(session.current.settings.enabledPages).toEqual({});
  });
});
