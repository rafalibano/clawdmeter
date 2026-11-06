import type { LaunchAtLogin } from '../ports';
import { GetLaunchAtLogin, type LaunchAtLoginState } from './get-launch-at-login';

export class SetLaunchAtLogin {
  private readonly read: GetLaunchAtLogin;

  constructor(private readonly launchAtLogin: LaunchAtLogin) {
    this.read = new GetLaunchAtLogin(launchAtLogin);
  }

  async execute(enabled: boolean): Promise<LaunchAtLoginState> {
    try {
      await (enabled ? this.launchAtLogin.enable() : this.launchAtLogin.disable());
    } catch {
      return { ...(await this.read.execute()), failed: 'write' };
    }
    const state = await this.read.execute();
    return state.failed || state.enabled !== enabled ? { ...state, failed: 'write' } : state;
  }
}
