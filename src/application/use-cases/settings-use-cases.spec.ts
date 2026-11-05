import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../../domain/settings';
import { FakeSettingsStore } from '../testing/fake-settings-store';
import { GetSettings } from './get-settings';
import { UpdateSettings } from './update-settings';
import { WatchSettings } from './watch-settings';

describe('settings use cases', () => {
  it('GetSettings reads from the store', async () => {
    const current = { ...createDefaultSettings(), enabledPages: { a: false } };
    expect(await new GetSettings(new FakeSettingsStore(current)).execute()).toBe(current);
  });

  it('UpdateSettings applies the patch, persists and returns the result', async () => {
    const store = new FakeSettingsStore();
    const result = await new UpdateSettings(store).execute({
      enabledPages: { example: false },
      appearance: { theme: 'dark' },
    });
    expect(result.enabledPages).toMatchObject({ example: false });
    expect(result.appearance.theme).toBe('dark');
    expect(store.saved).toEqual([result]);
  });

  it('UpdateSettings accumulates successive patches', async () => {
    const store = new FakeSettingsStore();
    const update = new UpdateSettings(store);
    await update.execute({ enabledPages: { a: false } });
    const result = await update.execute({ enabledPages: { b: false } });
    expect(result.enabledPages).toMatchObject({ a: false, b: false });
  });

  it('WatchSettings forwards external changes and allows unsubscribing', async () => {
    const store = new FakeSettingsStore();
    const listener = vi.fn();
    const stop = await new WatchSettings(store).execute(listener);
    const external = { ...createDefaultSettings(), enabledPages: { x: false } };
    store.emitExternalChange(external);
    expect(listener).toHaveBeenCalledWith(external);
    stop();
    store.emitExternalChange(createDefaultSettings());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
