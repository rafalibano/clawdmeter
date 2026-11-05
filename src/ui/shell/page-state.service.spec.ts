import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { createApplication } from '../../application/application';
import { pageRef } from '../../application/pages';
import { FakeClock, flushPromises } from '../../application/testing/fake-clock';
import { createFakeConnectionWorld } from '../../application/testing/fake-connection-adapters';
import { fakePage } from '../../application/testing/fake-page';
import { FakeSettingsStore } from '../../application/testing/fake-settings-store';
import { createDefaultSettings } from '../../domain/settings';
import { APPLICATION } from './application.token';
import { PageStateService } from './page-state.service';

interface Count {
  n: number;
}

function setup() {
  const clock = new FakeClock();
  const application = createApplication({
    clock,
    settingsStore: new FakeSettingsStore(),
    connectionAdapters: createFakeConnectionWorld().adapters,
    pages: [fakePage({ id: 'once', pollIntervalMs: null, load: async (): Promise<Count> => ({ n: 7 }) })],
  });
  const injector = Injector.create({ providers: [{ provide: APPLICATION, useValue: application }] });
  return { application, injector };
}

describe('PageStateService', () => {
  it('entrega o dado tipado da página assim que ela publica', async () => {
    const { application, injector } = setup();
    const service = runInInjectionContext(injector, () => new PageStateService());
    application.scheduler.sync(createDefaultSettings());
    await flushPromises();
    const update = service.of(pageRef<Count>('once'))();
    expect(update?.status === 'ok' && update.data.n).toBe(7);
    expect(service.get(pageRef<Count>('once'))).toBe(update);
  });

  it('não perde o update de página sem polling quando o serviço é criado depois', async () => {
    const { application, injector } = setup();
    application.scheduler.sync(createDefaultSettings());
    await flushPromises();
    const service = runInInjectionContext(injector, () => new PageStateService());
    expect(service.get(pageRef<Count>('once'))).toMatchObject({ status: 'ok', data: { n: 7 } });
  });

  it('devolve undefined para página sem update', () => {
    const { injector } = setup();
    const service = runInInjectionContext(injector, () => new PageStateService());
    expect(service.get(pageRef<Count>('outra'))).toBeUndefined();
  });
});
