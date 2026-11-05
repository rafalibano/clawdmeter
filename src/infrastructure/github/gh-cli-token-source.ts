import type { GitHubCliToken, GitHubCliTokenSource } from '../../application/ports';
import { PlatformCommandError } from '../platform/tauri-commands';
import type { TauriProcessRunner } from '../platform/tauri-process-runner';

export class GhCliTokenSource implements GitHubCliTokenSource {
  constructor(private readonly processes: TauriProcessRunner) {}

  async token(): Promise<GitHubCliToken> {
    try {
      const output = await this.processes.run('gh', ['auth', 'token', '-h', 'github.com']);
      const token = output.stdout.trim();
      return output.code === 0 && token !== '' ? { token } : { missing: 'not-logged-in' };
    } catch (error) {
      if (error instanceof PlatformCommandError && error.kind === 'program_not_found') return { missing: 'not-installed' };
      throw error;
    }
  }
}
