import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { createApplication } from '../../application/application';
import { pageRef } from '../../application/pages';
import { FakeClock, flushPromises } from '../../application/testing/fake-clock';
import { createFakeConnectionWorld } from '../../application/testing/fake-connection-adapters';
import { fakePage } from '../../application/testing/fake-page';
import { createFakeSkills } from '../../application/testing/fake-skills';
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
    skills: createFakeSkills(clock),
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

  it('guarda o último dado bom quando a próxima atualização falha', async () => {
    const clock = new FakeClock();
    let fail = false;
    const application = createApplication({
      clock,
      settingsStore: new FakeSettingsStore(),
      connectionAdapters: createFakeConnectionWorld().adapters,
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

  it('devolve undefined para página sem update', () => {
    const { injector } = setup();
    const service = runInInjectionContext(injector, () => new PageStateService());
    expect(service.get(pageRef<Count>('outra'))).toBeUndefined();
  });
});
