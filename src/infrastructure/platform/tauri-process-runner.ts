import type { TauriCommands } from './tauri-commands';

export interface RunOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class TauriProcessRunner {
  constructor(private readonly commands: TauriCommands) {}

  run(program: 'claude' | 'gh', args: string[], timeoutMs?: number): Promise<RunOutput> {
    return this.commands.call<RunOutput>('process_run', { program, args, timeoutMs });
  }
}
