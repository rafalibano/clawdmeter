import type { SettingsFileStatus, SettingsStore } from '../ports';

export class GetSettingsStatus {
  constructor(private readonly store: SettingsStore) {}

  execute(): SettingsFileStatus {
    return this.store.status();
  }
}
