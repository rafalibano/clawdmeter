import { DEFAULT_LANGUAGE, DEFAULT_USAGE_THRESHOLDS, type AppSettings } from './app-settings';
import { maintenancePagesOff } from './maintenance-pages';
import { SCHEMA_VERSION } from './schema-version';

export const DEFAULT_ACCENT_COLOR = '#00b131';

export function createDefaultSettings(): AppSettings {
  return {
    schemaVersion: SCHEMA_VERSION,
    enabledPages: maintenancePagesOff(),
    appearance: {
      accentColor: DEFAULT_ACCENT_COLOR,
      popoverBackground: null,
      theme: 'system',
    },
    language: DEFAULT_LANGUAGE,
    usageThresholds: { ...DEFAULT_USAGE_THRESHOLDS },
  };
}
