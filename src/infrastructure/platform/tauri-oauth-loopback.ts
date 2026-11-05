import type { TauriCommands } from './tauri-commands';

export interface LoopbackListener {
  id: string;
  port: number;
}

export interface OAuthLoopback {
  listen(): Promise<LoopbackListener>;
  waitForCode(id: string, expectedState: string, timeoutMs: number): Promise<string>;
  cancel(id: string): Promise<void>;
}

export class TauriOAuthLoopback implements OAuthLoopback {
  constructor(private readonly commands: TauriCommands) {}

  listen(): Promise<LoopbackListener> {
    return this.commands.call<LoopbackListener>('oauth_loopback_listen');
  }

  async waitForCode(id: string, expectedState: string, timeoutMs: number): Promise<string> {
    const result = await this.commands.call<{ code: string }>('oauth_loopback_wait', { id, expectedState, timeoutMs });
    return result.code;
  }

  cancel(id: string): Promise<void> {
    return this.commands.call<void>('oauth_loopback_cancel', { id });
  }
}
