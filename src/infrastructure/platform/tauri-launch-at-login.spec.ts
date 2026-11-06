import { describe, expect, it } from 'vitest';
import { createFakeCommands, rejectWith } from '../testing/fakes';
import { PlatformCommandError } from './tauri-commands';
import { TauriLaunchAtLogin } from './tauri-launch-at-login';

describe('TauriLaunchAtLogin', () => {
  it('talks to the launch_at_login_* commands without arguments', async () => {
    const { commands, calls } = createFakeCommands((command) =>
      command === 'launch_at_login_status' ? { supported: true, enabled: true } : undefined,
    );
    const adapter = new TauriLaunchAtLogin(commands);
    expect(await adapter.status()).toEqual({ supported: true, enabled: true });
    await adapter.enable();
    await adapter.disable();
    expect(calls).toEqual([
      { command: 'launch_at_login_status', args: undefined },
      { command: 'launch_at_login_enable', args: undefined },
      { command: 'launch_at_login_disable', args: undefined },
    ]);
  });

  it('reads an unsupported system and treats a malformed reply as unsupported and off', async () => {
    const unsupported = new TauriLaunchAtLogin(createFakeCommands(() => ({ supported: false, enabled: false })).commands);
    expect(await unsupported.status()).toEqual({ supported: false, enabled: false });
    const malformed = new TauriLaunchAtLogin(createFakeCommands(() => ({ supported: 'yes', enabled: 1 })).commands);
    expect(await malformed.status()).toEqual({ supported: false, enabled: false });
    const empty = new TauriLaunchAtLogin(createFakeCommands(() => null).commands);
    expect(await empty.status()).toEqual({ supported: false, enabled: false });
  });

  it('propagates the Rust errors with their kind', async () => {
    const { commands } = createFakeCommands(() =>
      rejectWith('policy', 'move it to /Applications and open it again before turning on launch at login'),
    );
    const adapter = new TauriLaunchAtLogin(commands);
    const error = await adapter.enable().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PlatformCommandError);
    expect((error as PlatformCommandError).kind).toBe('policy');
    await expect(adapter.status()).rejects.toBeInstanceOf(PlatformCommandError);
  });
});
