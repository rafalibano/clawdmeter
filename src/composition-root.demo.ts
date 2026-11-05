import { createApplication, type Application } from './application/application';
import { JsonSettingsStore, LocalStorageJsonFile } from './infrastructure/persistence';
import { SystemClock } from './infrastructure/platform/system-clock';
import { createExamplePage } from './ui/pages/example/example.page';

export function createComposition(): Application {
  const clock = new SystemClock();
  return createApplication({
    clock,
    settingsStore: new JsonSettingsStore(new LocalStorageJsonFile('dev-pulse.settings')),
    pages: [createExamplePage({ clock })],
  });
}
