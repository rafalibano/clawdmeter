import type { LaunchAtLogin } from '../ports';

export class FakeLaunchAtLogin implements LaunchAtLogin {
  failRead = false;
  failWrite = false;
  ignoreWrites = false;
  readonly writes: boolean[] = [];

  constructor(public enabled = false) {}

  async isEnabled(): Promise<boolean> {
    if (this.failRead) throw new Error('launch agent unreadable');
    return this.enabled;
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
