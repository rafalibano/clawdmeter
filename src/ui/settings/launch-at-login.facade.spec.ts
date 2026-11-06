import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { flushPromises } from '../../application/testing/fake-clock';
import { FakeLaunchAtLogin } from '../../application/testing/fake-launch-at-login';
import { GetLaunchAtLogin, SetLaunchAtLogin } from '../../application/use-cases';
import { APPLICATION } from '../shell/application.token';
import { LaunchAtLoginFacade } from './launch-at-login.facade';

async function setup(system: FakeLaunchAtLogin) {
  const application = { getLaunchAtLogin: new GetLaunchAtLogin(system), setLaunchAtLogin: new SetLaunchAtLogin(system) };
  const injector = Injector.create({ providers: [{ provide: APPLICATION, useValue: application }] });
  const facade = runInInjectionContext(injector, () => new LaunchAtLoginFacade());
  expect(facade.busy()).toBe(true);
  await flushPromises();
  return facade;
}

describe('LaunchAtLoginFacade', () => {
  it('starts from the state read from the system', async () => {
    const facade = await setup(new FakeLaunchAtLogin(true));
    expect(facade.supported()).toBe(true);
    expect(facade.enabled()).toBe(true);
    expect(facade.failed()).toBe(false);
    expect(facade.busy()).toBe(false);
  });

  it('is not supported until the system answers', () => {
    const system = new FakeLaunchAtLogin(true);
    const application = { getLaunchAtLogin: new GetLaunchAtLogin(system), setLaunchAtLogin: new SetLaunchAtLogin(system) };
    const injector = Injector.create({ providers: [{ provide: APPLICATION, useValue: application }] });
    const facade = runInInjectionContext(injector, () => new LaunchAtLoginFacade());
    expect(facade.supported()).toBe(false);
    expect(facade.ready()).toBe(false);
  });

  it('reports an unsupported system so the section stays hidden', async () => {
    const facade = await setup(new FakeLaunchAtLogin(false, false));
    expect(facade.supported()).toBe(false);
    expect(facade.enabled()).toBe(false);
    expect(facade.failed()).toBe(false);
    expect(facade.ready()).toBe(true);
  });

  it('turns on and off', async () => {
    const system = new FakeLaunchAtLogin(false);
    const facade = await setup(system);
    await facade.set(true);
    expect(facade.enabled()).toBe(true);
    expect(system.enabled).toBe(true);
    await facade.set(false);
    expect(facade.enabled()).toBe(false);
    expect(system.enabled).toBe(false);
    expect(facade.failed()).toBe(false);
  });

  it('shows the requested value while the change is pending and ignores toggles meanwhile', async () => {
    const system = new FakeLaunchAtLogin(false);
    const facade = await setup(system);
    const pending = facade.set(true);
    expect(facade.enabled()).toBe(true);
    expect(facade.busy()).toBe(true);
    await facade.set(false);
    await pending;
    expect(system.writes).toEqual([true]);
    expect(facade.busy()).toBe(false);
  });

  it('goes back to the real state and reports the error when the system fails', async () => {
    const system = new FakeLaunchAtLogin(false);
    const facade = await setup(system);
    system.failWrite = true;
    await facade.set(true);
    expect(facade.enabled()).toBe(false);
    expect(facade.failed()).toBe('write');
    expect(facade.busy()).toBe(false);

    system.failWrite = false;
    await facade.set(true);
    expect(facade.enabled()).toBe(true);
    expect(facade.failed()).toBe(false);
  });

  it('reports a failed read without blocking the switch', async () => {
    const system = new FakeLaunchAtLogin(true);
    system.failRead = true;
    const facade = await setup(system);
    expect(facade.supported()).toBe(true);
    expect(facade.enabled()).toBe(false);
    expect(facade.failed()).toBe('read');
    expect(facade.busy()).toBe(false);
  });

  it('survives a use case that rejects on load', async () => {
    const system = new FakeLaunchAtLogin(true);
    const application = {
      getLaunchAtLogin: { execute: async () => Promise.reject(new Error('boom')) },
      setLaunchAtLogin: new SetLaunchAtLogin(system),
    };
    const injector = Injector.create({ providers: [{ provide: APPLICATION, useValue: application }] });
    const facade = runInInjectionContext(injector, () => new LaunchAtLoginFacade());
    await flushPromises();
    expect(facade.supported()).toBe(true);
    expect(facade.enabled()).toBe(false);
    expect(facade.failed()).toBe('read');
    expect(facade.busy()).toBe(false);
  });

  it('goes back to the previous value when the set use case rejects', async () => {
    const system = new FakeLaunchAtLogin(true);
    const application = {
      getLaunchAtLogin: new GetLaunchAtLogin(system),
      setLaunchAtLogin: { execute: async () => Promise.reject(new Error('boom')) },
    };
    const injector = Injector.create({ providers: [{ provide: APPLICATION, useValue: application }] });
    const facade = runInInjectionContext(injector, () => new LaunchAtLoginFacade());
    await flushPromises();
    await facade.set(false);
    expect(facade.supported()).toBe(true);
    expect(facade.enabled()).toBe(true);
    expect(facade.failed()).toBe('write');
    expect(facade.busy()).toBe(false);
  });
});
