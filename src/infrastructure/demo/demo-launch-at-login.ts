import type { LaunchAtLogin } from '../../application/ports';

export class DemoLaunchAtLogin implements LaunchAtLogin {
  private enabled = false;

  async isEnabled(): Promise<boolean> {
    return this.enabled;
  }

  async enable(): Promise<void> {
    this.enabled = true;
  }

  async disable(): Promise<void> {
    this.enabled = false;
  }
}
