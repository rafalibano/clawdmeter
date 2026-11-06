import { describe, expect, it } from 'vitest';
import { TauriLaunchAtLogin } from './tauri-launch-at-login';

describe('TauriLaunchAtLogin', () => {
  it('delegates to the autostart plugin and propagates its errors', async () => {
    const calls: string[] = [];
    const adapter = new TauriLaunchAtLogin({
      isEnabled: async () => {
        calls.push('isEnabled');
        return true;
      },
      enable: async () => {
        calls.push('enable');
      },
      disable: async () => {
        throw new Error('registry denied');
      },
    });
    expect(await adapter.isEnabled()).toBe(true);
    await adapter.enable();
    await expect(adapter.disable()).rejects.toThrow('registry denied');
    expect(calls).toEqual(['isEnabled', 'enable']);
  });
});
