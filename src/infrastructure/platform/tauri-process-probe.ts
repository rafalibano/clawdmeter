import type { ProcessProbe } from '../../application/ports';
import type { TauriCommands } from './tauri-commands';

export class TauriProcessProbe implements ProcessProbe {
  constructor(private readonly commands: TauriCommands) {}

  isAlive(pid: number): Promise<boolean> {
    return this.commands.call<boolean>('process_is_alive', { pid });
  }
}
