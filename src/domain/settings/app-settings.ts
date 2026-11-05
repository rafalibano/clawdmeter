import type { PageId } from './page-id';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export interface AppearanceSettings {
  accentColor: string;
  popoverBackground: string | null;
  theme: ThemeMode;
}

export interface AppSettings {
  schemaVersion: number;
  enabledPages: Record<PageId, boolean>;
  appearance: AppearanceSettings;
}
