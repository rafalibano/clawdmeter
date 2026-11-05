import { applyPatch, type AppSettings, type SettingsPatch } from '../../domain/settings';
import type { SettingsStore } from '../ports';

export class UpdateSettings {
  constructor(private readonly store: SettingsStore) {}

  async execute(patch: SettingsPatch): Promise<AppSettings> {
    const next = applyPatch(await this.store.load(), patch);
    await this.store.save(next);
    return next;
  }
}
