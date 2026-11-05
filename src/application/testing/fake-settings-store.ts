import type { AppSettings } from '../../domain/settings';
import { createDefaultSettings } from '../../domain/settings';
import type { SettingsStore, Unsubscribe } from '../ports';

export class FakeSettingsStore implements SettingsStore {
  saved: AppSettings[] = [];
  private readonly listeners = new Set<(settings: AppSettings) => void>();

  constructor(private current: AppSettings = createDefaultSettings()) {}

  async load(): Promise<AppSettings> {
    return this.current;
  }

  async save(settings: AppSettings): Promise<void> {
    this.current = settings;
    this.saved.push(settings);
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
