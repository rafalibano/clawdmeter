import type { AvailableUpdate, DownloadProgress, UpdateChecker } from '../ports';

export class FakeUpdateChecker implements UpdateChecker {
  version = '0.1.0';
  outcome: AvailableUpdate | null | Error = null;
  installOutcome: Error | null = null;
  progress: DownloadProgress[] = [];
  checks: string[] = [];
  installs: string[] = [];
  restarts = 0;

  async currentVersion(): Promise<string> {
    return this.version;
  }

  async check(token: string): Promise<AvailableUpdate | null> {
    this.checks.push(token);
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }

  async install(token: string, onProgress: (progress: DownloadProgress) => void): Promise<void> {
    this.installs.push(token);
    for (const step of this.progress) onProgress(step);
    if (this.installOutcome) throw this.installOutcome;
  }

  async restart(): Promise<void> {
    this.restarts += 1;
  }
}
