import { describe, expect, it } from 'vitest';
import { FakeLaunchAtLogin } from '../testing/fake-launch-at-login';
import { GetLaunchAtLogin } from './get-launch-at-login';
import { SetLaunchAtLogin } from './set-launch-at-login';

describe('launch at login use cases', () => {
  it('GetLaunchAtLogin reads the state from the system', async () => {
    expect(await new GetLaunchAtLogin(new FakeLaunchAtLogin(true)).execute()).toEqual({ enabled: true, failed: false });
    expect(await new GetLaunchAtLogin(new FakeLaunchAtLogin(false)).execute()).toEqual({ enabled: false, failed: false });
  });

  it('GetLaunchAtLogin reports a failed read as off and failed', async () => {
    const system = new FakeLaunchAtLogin(true);
    system.failRead = true;
    expect(await new GetLaunchAtLogin(system).execute()).toEqual({ enabled: false, failed: 'read' });
  });

  it('SetLaunchAtLogin turns on and off and returns the state read back from the system', async () => {
    const system = new FakeLaunchAtLogin();
    const set = new SetLaunchAtLogin(system);
    expect(await set.execute(true)).toEqual({ enabled: true, failed: false });
    expect(await set.execute(false)).toEqual({ enabled: false, failed: false });
    expect(system.writes).toEqual([true, false]);
  });

  it('SetLaunchAtLogin returns the real state and failed when the plugin rejects', async () => {
    const system = new FakeLaunchAtLogin(false);
    system.failWrite = true;
    expect(await new SetLaunchAtLogin(system).execute(true)).toEqual({ enabled: false, failed: 'write' });

    const enabled = new FakeLaunchAtLogin(true);
    enabled.failWrite = true;
    expect(await new SetLaunchAtLogin(enabled).execute(false)).toEqual({ enabled: true, failed: 'write' });
  });

  it('SetLaunchAtLogin flags failed when the system does not reflect the change', async () => {
    const system = new FakeLaunchAtLogin(false);
    system.ignoreWrites = true;
    expect(await new SetLaunchAtLogin(system).execute(true)).toEqual({ enabled: false, failed: 'write' });
  });

  it('SetLaunchAtLogin flags failed when turning off does not take effect', async () => {
    const system = new FakeLaunchAtLogin(true);
    system.ignoreWrites = true;
    expect(await new SetLaunchAtLogin(system).execute(false)).toEqual({ enabled: true, failed: 'write' });
  });
});
