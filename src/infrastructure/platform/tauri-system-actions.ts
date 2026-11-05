import type { SystemSettings, TerminalCommand, TerminalLauncher, UrlOpener } from '../../application/ports';
import type { TauriCommands } from './tauri-commands';

export class TauriUrlOpener implements UrlOpener {
  constructor(private readonly commands: TauriCommands) {}

  open(url: string): Promise<void> {
    return this.commands.call<void>('open_url', { url });
  }
}

export class TauriSystemSettings implements SystemSettings {
  constructor(private readonly commands: TauriCommands) {}

  openNotifications(): Promise<void> {
    return this.commands.call<void>('open_system_settings', { pane: 'notifications' });
  }
}

export class TauriTerminalLauncher implements TerminalLauncher {
  constructor(private readonly commands: TauriCommands) {}

  run(command: TerminalCommand): Promise<void> {
    return this.commands.call<void>('terminal_run', { program: command.program, args: command.args, cwd: command.cwd ?? null });
  }
}
