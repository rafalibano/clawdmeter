import type { AppSettings } from '../../domain/settings';
import type { SettingsStore } from '../ports';

export class GetSettings {
  constructor(private readonly store: SettingsStore) {}

  execute(): Promise<AppSettings> {
    return this.store.load();
  }
}
