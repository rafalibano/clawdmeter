import type { LaunchAtLogin, LaunchAtLoginStatus } from '../../application/ports';

export class DemoLaunchAtLogin implements LaunchAtLogin {
  private enabled = false;

  async status(): Promise<LaunchAtLoginStatus> {
    return { supported: true, enabled: this.enabled };
  }

  async enable(): Promise<void> {
    this.enabled = true;
  }

  async disable(): Promise<void> {
    this.enabled = false;
  }
}
