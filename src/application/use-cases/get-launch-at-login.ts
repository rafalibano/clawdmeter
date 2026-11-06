import type { LaunchAtLogin } from '../ports';

export interface LaunchAtLoginState {
  supported: boolean;
  enabled: boolean;
  failed: 'read' | 'write' | false;
}

export class GetLaunchAtLogin {
  constructor(private readonly launchAtLogin: LaunchAtLogin) {}

  async execute(): Promise<LaunchAtLoginState> {
    try {
      const { supported, enabled } = await this.launchAtLogin.status();
      return { supported, enabled: supported && enabled, failed: false };
    } catch {
      return { supported: true, enabled: false, failed: 'read' };
    }
  }
}
