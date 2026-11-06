import type { LaunchAtLogin, LaunchAtLoginStatus } from '../ports';

export class FakeLaunchAtLogin implements LaunchAtLogin {
  failRead = false;
  failWrite = false;
  ignoreWrites = false;
  readonly writes: boolean[] = [];

  constructor(
    public enabled = false,
    public supported = true,
  ) {}

  async status(): Promise<LaunchAtLoginStatus> {
    if (this.failRead) throw new Error('launch agent unreadable');
    return { supported: this.supported, enabled: this.enabled };
  }

  async enable(): Promise<void> {
    this.write(true);
  }

  async disable(): Promise<void> {
    this.write(false);
  }

  private write(enabled: boolean): void {
    this.writes.push(enabled);
    if (this.failWrite) throw new Error('launch agent not writable');
    if (!this.ignoreWrites) this.enabled = enabled;
  }
}
