import type { AppSettings } from './app-settings';
import { SCHEMA_VERSION } from './schema-version';

export const DEFAULT_ACCENT_COLOR = '#00b131';

export function createDefaultSettings(): AppSettings {
  return {
    schemaVersion: SCHEMA_VERSION,
    enabledPages: {},
    appearance: {
      accentColor: DEFAULT_ACCENT_COLOR,
      popoverBackground: null,
      theme: 'system',
    },
  };
}
