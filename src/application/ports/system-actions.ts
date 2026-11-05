export interface UrlOpener {
  open(url: string): Promise<void>;
}

export interface SystemSettings {
  openNotifications(): Promise<void>;
}

export interface TerminalCommand {
  program: 'claude' | 'gh';
  args: string[];
  cwd?: string | null;
}

export interface TerminalLauncher {
  run(command: TerminalCommand): Promise<void>;
}
