import type { SecretStore } from '../../application/ports';
import type { TauriCommands } from './tauri-commands';

export class TauriSecretStore implements SecretStore {
  constructor(private readonly commands: TauriCommands) {}

  get(key: string): Promise<string | null> {
    return this.commands.call<string | null>('secret_get', { key });
  }

  set(key: string, value: string): Promise<void> {
    return this.commands.call<void>('secret_set', { key, value });
  }

  delete(key: string): Promise<void> {
    return this.commands.call<void>('secret_delete', { key });
  }
}
