import { describe, expect, it } from 'vitest';
import { createApplication } from './application';
import { FakeClock } from './testing/fake-clock';
import { createFakeConnectionWorld } from './testing/fake-connection-adapters';
import { createFakeSkills } from './testing/fake-skills';
import { fakePage } from './testing/fake-page';
import { FakeSettingsStore } from './testing/fake-settings-store';

function deps() {
  const clock = new FakeClock();
  return {
    clock,
    settingsStore: new FakeSettingsStore(),
    connectionAdapters: createFakeConnectionWorld().adapters,
    skills: createFakeSkills(clock),
  };
}

describe('createApplication', () => {
  it('aceita a lista de páginas direta', () => {
    const app = createApplication({ ...deps(), pages: [fakePage({ id: 'a' })] });
    expect(app.registry.all().map((page) => page.id)).toEqual(['a']);
  });

  it('aceita uma fábrica de páginas que recebe as conexões da própria aplicação', () => {
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
});
