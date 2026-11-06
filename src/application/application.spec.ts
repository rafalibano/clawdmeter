import { describe, expect, it } from 'vitest';
import { createApplication } from './application';
import { FakeClock } from './testing/fake-clock';
import { createFakeConnectionWorld } from './testing/fake-connection-adapters';
import { createFakeSkills } from './testing/fake-skills';
import { fakePage } from './testing/fake-page';
import { FakeSettingsStore } from './testing/fake-settings-store';
import { FakeUpdateChecker } from './testing/fake-update-checker';
import { FakeUsageHistoryStores } from './testing/fake-usage-adapters';

function deps() {
  const clock = new FakeClock();
  return {
    clock,
    settingsStore: new FakeSettingsStore(),
    connectionAdapters: createFakeConnectionWorld().adapters,
    usageHistories: new FakeUsageHistoryStores(),
    updateChecker: new FakeUpdateChecker(),
    skills: createFakeSkills(clock),
  };
}

describe('createApplication', () => {
  it('accepts a direct list of pages', () => {
    const app = createApplication({ ...deps(), pages: [fakePage({ id: 'a' })] });
    expect(app.registry.all().map((page) => page.id)).toEqual(['a']);
  });

  it('accepts a page factory that receives the application own connections', () => {
    let received: unknown;
    const app = createApplication({
      ...deps(),
      pages: (context) => {
        received = context.connections;
        return [fakePage({ id: 'b' })];
      },
    });
    expect(app.registry.all().map((page) => page.id)).toEqual(['b']);
    expect(received).toBe(app.connections);
  });

  it('accepts ready skills or a factory that receives the connections, and passes the skills to the pages', () => {
    const clock = new FakeClock();
    const ready = createFakeSkills(clock);
    const direct = createApplication({ ...deps(), skills: ready, pages: [] });
    expect(direct.skills).toBe(ready);

    let receivedConnections: unknown;
    let receivedSkills: unknown;
    const built = createFakeSkills(clock);
    const app = createApplication({
      ...deps(),
      skills: (context) => {
        receivedConnections = context.connections;
        return built;
      },
      pages: (context) => {
        receivedSkills = context.skills;
        return [];
      },
    });
    expect(receivedConnections).toBe(app.connections);
    expect(receivedSkills).toBe(built);
    expect(app.skills).toBe(built);
  });
});
