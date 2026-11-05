import type { ClaudeCredential, ClaudeCredentialSource } from '../../application/ports';
import type { TauriCommands } from './tauri-commands';

export class TauriClaudeCredentialSource implements ClaudeCredentialSource {
  constructor(private readonly commands: TauriCommands) {}

  read(): Promise<ClaudeCredential> {
    return this.commands.call<ClaudeCredential>('claude_credentials_status');
  }
}
