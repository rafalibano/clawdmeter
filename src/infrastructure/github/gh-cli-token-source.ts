import type { GitHubCliTokenSource } from '../../application/ports';
import { PlatformCommandError } from '../platform/tauri-commands';
import type { TauriProcessRunner } from '../platform/tauri-process-runner';

export class GhCliTokenSource implements GitHubCliTokenSource {
  constructor(private readonly processes: TauriProcessRunner) {}

  async token(): Promise<string | null> {
    try {
      const output = await this.processes.run('gh', ['auth', 'token', '-h', 'github.com']);
      const token = output.stdout.trim();
      return output.code === 0 && token !== '' ? token : null;
    } catch (error) {
      if (error instanceof PlatformCommandError && error.kind === 'program_not_found') return null;
      throw error;
    }
  }
}
