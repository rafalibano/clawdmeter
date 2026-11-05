import type { AppSettings } from '../../domain/settings';
import { createDefaultSettings } from '../../domain/settings';
import { SettingsWriteBlockedError, type SettingsFileStatus, type SettingsStore, type Unsubscribe } from '../ports';

export class FakeSettingsStore implements SettingsStore {
  saved: AppSettings[] = [];
  fileStatus: SettingsFileStatus = 'ok';
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor(private current: AppSettings = createDefaultSettings()) {}

  async load(): Promise<AppSettings> {
    return this.current;
  }

  async save(settings: AppSettings): Promise<void> {
    if (this.fileStatus !== 'ok') throw new SettingsWriteBlockedError(this.fileStatus);
    this.current = settings;
    this.saved.push(settings);
  }

  status(): SettingsFileStatus {
    return this.fileStatus;
  }

  async watch(listener: (settings: AppSettings) => void): Promise<Unsubscribe> {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitExternalChange(settings: AppSettings): void {
    this.current = settings;
    for (const listener of this.listeners) listener(settings);
  }
}
