import { describe, expect, it } from 'vitest';
import { FakeLaunchAtLogin } from '../testing/fake-launch-at-login';
import { GetLaunchAtLogin } from './get-launch-at-login';
import { SetLaunchAtLogin } from './set-launch-at-login';

describe('launch at login use cases', () => {
  it('GetLaunchAtLogin reads the state from the system', async () => {
    expect(await new GetLaunchAtLogin(new FakeLaunchAtLogin(true)).execute()).toEqual({
      supported: true,
      enabled: true,
      failed: false,
    });
    expect(await new GetLaunchAtLogin(new FakeLaunchAtLogin(false)).execute()).toEqual({
      supported: true,
      enabled: false,
      failed: false,
    });
  });

  it('GetLaunchAtLogin reports an unsupported system as unsupported and off', async () => {
    expect(await new GetLaunchAtLogin(new FakeLaunchAtLogin(false, false)).execute()).toEqual({
      supported: false,
      enabled: false,
      failed: false,
    });
    expect(await new GetLaunchAtLogin(new FakeLaunchAtLogin(true, false)).execute()).toEqual({
      supported: false,
      enabled: false,
      failed: false,
    });
  });

  it('GetLaunchAtLogin reports a failed read as off and failed', async () => {
    const system = new FakeLaunchAtLogin(true);
    system.failRead = true;
    expect(await new GetLaunchAtLogin(system).execute()).toEqual({ supported: true, enabled: false, failed: 'read' });
  });

  it('SetLaunchAtLogin turns on and off and returns the state read back from the system', async () => {
    const system = new FakeLaunchAtLogin();
    const set = new SetLaunchAtLogin(system);
    expect(await set.execute(true)).toEqual({ supported: true, enabled: true, failed: false });
    expect(await set.execute(false)).toEqual({ supported: true, enabled: false, failed: false });
    expect(system.writes).toEqual([true, false]);
  });

  it('SetLaunchAtLogin returns the real state and failed when the system rejects', async () => {
    const system = new FakeLaunchAtLogin(false);
    system.failWrite = true;
    expect(await new SetLaunchAtLogin(system).execute(true)).toEqual({ supported: true, enabled: false, failed: 'write' });

    const enabled = new FakeLaunchAtLogin(true);
    enabled.failWrite = true;
    expect(await new SetLaunchAtLogin(enabled).execute(false)).toEqual({ supported: true, enabled: true, failed: 'write' });
  });

  it('SetLaunchAtLogin on an unsupported system reports the write as failed and stays off', async () => {
    const system = new FakeLaunchAtLogin(false, false);
    system.failWrite = true;
    expect(await new SetLaunchAtLogin(system).execute(true)).toEqual({ supported: false, enabled: false, failed: 'write' });
  });

  it('SetLaunchAtLogin flags failed when the system does not reflect the change', async () => {
    const system = new FakeLaunchAtLogin(false);
    system.ignoreWrites = true;
    expect(await new SetLaunchAtLogin(system).execute(true)).toEqual({ supported: true, enabled: false, failed: 'write' });
  });

  it('SetLaunchAtLogin flags failed when turning off does not take effect', async () => {
    const system = new FakeLaunchAtLogin(true);
    system.ignoreWrites = true;
    expect(await new SetLaunchAtLogin(system).execute(false)).toEqual({ supported: true, enabled: true, failed: 'write' });
  });

  it('SetLaunchAtLogin keeps failed read when the write worked and only the read-back fails', async () => {
    const system = new FakeLaunchAtLogin(false);
    const enable = system.enable.bind(system);
    system.enable = async () => {
      await enable();
      system.failRead = true;
    };
    expect(await new SetLaunchAtLogin(system).execute(true)).toEqual({ supported: true, enabled: false, failed: 'read' });
    expect(system.writes).toEqual([true]);
  });
});
