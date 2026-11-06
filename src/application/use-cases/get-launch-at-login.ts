import type { LaunchAtLogin } from '../ports';

export interface LaunchAtLoginState {
  enabled: boolean;
  failed: 'read' | 'write' | false;
}

export class GetLaunchAtLogin {
  constructor(private readonly launchAtLogin: LaunchAtLogin) {}

  async execute(): Promise<LaunchAtLoginState> {
    try {
      return { enabled: await this.launchAtLogin.isEnabled(), failed: false };
    } catch {
      return { enabled: false, failed: 'read' };
    }
  }
}
