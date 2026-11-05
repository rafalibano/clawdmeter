import type { AppSettings } from '../../domain/settings';

export type Unsubscribe = () => void;

export type SettingsFileStatus = 'ok' | 'invalid' | 'future';

export class SettingsWriteBlockedError extends Error {
  constructor(readonly reason: Exclude<SettingsFileStatus, 'ok'>) {
    super(`settings.json is locked for writing: ${reason}`);
    this.name = 'SettingsWriteBlockedError';
  }
}

export interface SettingsStore {
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
  watch(listener: (settings: AppSettings) => void): Promise<Unsubscribe>;
  status(): SettingsFileStatus;
}
