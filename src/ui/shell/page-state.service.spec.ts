import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { createApplication } from '../../application/application';
import { pageRef } from '../../application/pages';
import { FakeClock, flushPromises } from '../../application/testing/fake-clock';
import { FakeLaunchAtLogin } from '../../application/testing/fake-launch-at-login';
import { createFakeConnectionWorld } from '../../application/testing/fake-connection-adapters';
import { fakePage } from '../../application/testing/fake-page';
import { createFakeSkills } from '../../application/testing/fake-skills';
import { FakeSettingsStore } from '../../application/testing/fake-settings-store';
import { createDefaultSettings } from '../../domain/settings';
import { APPLICATION } from './application.token';
import { PageStateService } from './page-state.service';
import { FakeUpdateChecker } from '../../application/testing/fake-update-checker';
import { FakeUsageHistoryStores } from '../../application/testing/fake-usage-adapters';

interface Count {
  n: number;
}

function setup() {
  const clock = new FakeClock();
  const application = createApplication({
    clock,
    settingsStore: new FakeSettingsStore(),
    connectionAdapters: createFakeConnectionWorld().adapters,
    usageHistories: new FakeUsageHistoryStores(),
    updateChecker: new FakeUpdateChecker(),
    launchAtLogin: new FakeLaunchAtLogin(),
    skills: createFakeSkills(clock),
    pages: [fakePage({ id: 'once', pollIntervalMs: null, load: async (): Promise<Count> => ({ n: 7 }) })],
  });
  const injector = Injector.create({ providers: [{ provide: APPLICATION, useValue: application }] });
  return { application, injector };
}

describe('PageStateService', () => {
  it('delivers the typed page data as soon as it publishes', async () => {
    const { application, injector } = setup();
    const service = runInInjectionContext(injector, () => new PageStateService());
    application.scheduler.sync(createDefaultSettings());
    await flushPromises();
    const update = service.of(pageRef<Count>('once'))();
    expect(update?.status === 'ok' && update.data.n).toBe(7);
    expect(service.get(pageRef<Count>('once'))).toBe(update);
  });

  it('does not lose the update of a page without polling when the service is created later', async () => {
    const { application, injector } = setup();
    application.scheduler.sync(createDefaultSettings());
    await flushPromises();
    const service = runInInjectionContext(injector, () => new PageStateService());
    expect(service.get(pageRef<Count>('once'))).toMatchObject({ status: 'ok', data: { n: 7 } });
  });

  it('keeps the last good data when the next update fails', async () => {
    const clock = new FakeClock();
    let fail = false;
    const application = createApplication({
      clock,
      settingsStore: new FakeSettingsStore(),
      connectionAdapters: createFakeConnectionWorld().adapters,
      usageHistories: new FakeUsageHistoryStores(),
      updateChecker: new FakeUpdateChecker(),
      launchAtLogin: new FakeLaunchAtLogin(),
      skills: createFakeSkills(clock),
      pages: [
        fakePage({
          id: 'poll',
          pollIntervalMs: 1_000,
          load: async (): Promise<Count> => {
            if (fail) throw new Error('rede fora');
            return { n: 1 };
          },
        }),
      ],
    });
    const injector = Injector.create({ providers: [{ provide: APPLICATION, useValue: application }] });
    const service = runInInjectionContext(injector, () => new PageStateService());
    const ref = pageRef<Count>('poll');
    const last = service.lastOk(ref);
    expect(last()).toBeUndefined();
    application.scheduler.sync(createDefaultSettings());
    await flushPromises();
    expect(last()).toEqual({ n: 1 });
    fail = true;
    await clock.advance(1_000);
    expect(service.get(ref)).toMatchObject({ status: 'error', error: 'rede fora' });
    expect(last()).toEqual({ n: 1 });
  });

  it('returns undefined for a page without an update', () => {
    const { injector } = setup();
    const service = runInInjectionContext(injector, () => new PageStateService());
    expect(service.get(pageRef<Count>('outra'))).toBeUndefined();
  });
});
