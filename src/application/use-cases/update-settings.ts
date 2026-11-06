import { applyPatch, type AppSettings, type SettingsPatch } from '../../domain/settings';
import type { SettingsStore, Unsubscribe } from '../ports';

export type SettingsChange = SettingsPatch | ((current: AppSettings) => SettingsPatch);

export class UpdateSettings {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor(private readonly store: SettingsStore) {}

  execute(change: SettingsChange): Promise<AppSettings> {
    const write = this.queue.then(() => this.write(change));
    this.queue = write.catch(() => undefined);
    return write;
  }

  subscribe(listener: (settings: AppSettings) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async write(change: SettingsChange): Promise<AppSettings> {
    const current = await this.store.load();
    const next = applyPatch(current, typeof change === 'function' ? change(current) : change);
    await this.store.save(next);
    for (const listener of this.listeners) listener(next);
    return next;
  }
}
