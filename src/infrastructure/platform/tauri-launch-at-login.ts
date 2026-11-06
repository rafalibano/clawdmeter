import type { LaunchAtLogin, LaunchAtLoginStatus } from '../../application/ports';
import type { TauriCommands } from './tauri-commands';

export class TauriLaunchAtLogin implements LaunchAtLogin {
  constructor(private readonly commands: TauriCommands) {}

  async status(): Promise<LaunchAtLoginStatus> {
    const raw = await this.commands.call<Partial<LaunchAtLoginStatus> | null>('launch_at_login_status');
    return { supported: raw?.supported === true, enabled: raw?.enabled === true };
  }

  enable(): Promise<void> {
    return this.commands.call<void>('launch_at_login_enable');
  }

  disable(): Promise<void> {
    return this.commands.call<void>('launch_at_login_disable');
  }
}
