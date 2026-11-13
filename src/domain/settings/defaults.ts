import { DEFAULT_LANGUAGE, type AppSettings } from './app-settings';
import { DEFAULT_PROJECTION_METHOD } from '../usage/projection-method';
import { defaultUsageAlerts } from '../usage/usage-alerts';
import { defaultUsageBlocks } from '../usage/usage-blocks';
import { defaultClaudeSettings } from './claude-accounts';
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
    projectionMethod: DEFAULT_PROJECTION_METHOD,
    seriesColors: { fiveHour: null, sevenDay: null },
    usageAlerts: defaultUsageAlerts(),
    usageBlocks: defaultUsageBlocks(),
    claude: defaultClaudeSettings(),
  };
}
