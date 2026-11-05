import type { ConnectionMonitor } from '../../../connections/connection-monitor';
import { statusFromError } from '../../../connections/connection-runner';
import type { DeviceCode, GitHubDeviceFlow } from '../../../ports';

export class StartGitHubDeviceFlow {
  constructor(
    private readonly flow: GitHubDeviceFlow,
    private readonly monitor: ConnectionMonitor,
  ) {}

  async execute(): Promise<DeviceCode | null> {
    try {
      return await this.flow.start();
    } catch (error) {
      this.monitor.set('github', statusFromError(error));
      return null;
    }
  }
}
