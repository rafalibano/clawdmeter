import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import type { LaunchAtLogin } from '../../application/ports';

const pluginApi: LaunchAtLogin = { isEnabled, enable, disable };

export class TauriLaunchAtLogin implements LaunchAtLogin {
  constructor(private readonly api: LaunchAtLogin = pluginApi) {}

  isEnabled(): Promise<boolean> {
    return this.api.isEnabled();
  }

  enable(): Promise<void> {
    return this.api.enable();
  }

  disable(): Promise<void> {
    return this.api.disable();
  }
}
