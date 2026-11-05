import type { DeviceCode, GitHubDeviceFlow } from '../../../ports';

export class StartGitHubDeviceFlow {
  constructor(private readonly flow: GitHubDeviceFlow) {}

  execute(): Promise<DeviceCode> {
    return this.flow.start();
  }
}
