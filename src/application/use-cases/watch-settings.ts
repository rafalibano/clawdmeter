import type { AppSettings } from '../../domain/settings';
import type { SettingsStore, Unsubscribe } from '../ports';

export class WatchSettings {
  constructor(private readonly store: SettingsStore) {}

  execute(listener: (settings: AppSettings) => void): Promise<Unsubscribe> {
    return this.store.watch(listener);
  }
}
