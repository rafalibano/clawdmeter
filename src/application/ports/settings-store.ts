import type { AppSettings } from '../../domain/settings';

export type Unsubscribe = () => void;

export interface SettingsStore {
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
  watch(listener: (settings: AppSettings) => void): Promise<Unsubscribe>;
}
