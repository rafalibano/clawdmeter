import type { StartupNotice, StartupNotices } from '../../application/ports';
import type { TauriCommands } from './tauri-commands';

export function toStartupNotice(raw: unknown): StartupNotice | null {
  return raw === 'no-tray' ? raw : null;
}

export class TauriStartupNotices implements StartupNotices {
  constructor(private readonly commands: TauriCommands) {}

  async pending(): Promise<StartupNotice | null> {
    return toStartupNotice(await this.commands.call<string | null>('startup_notice'));
  }
}
