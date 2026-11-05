import { createApplication, type Application } from './application/application';
import { JsonSettingsStore } from './infrastructure/persistence';
import { SystemClock, TauriJsonFile } from './infrastructure/platform';
import { createExamplePage } from './ui/pages/example/example.page';

export function createComposition(): Application {
  const clock = new SystemClock();
  return createApplication({
    clock,
    settingsStore: new JsonSettingsStore(new TauriJsonFile('settings.json')),
    pages: [createExamplePage({ clock })],
  });
}
