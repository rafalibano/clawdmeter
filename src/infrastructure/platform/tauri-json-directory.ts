import { appConfigDir, join } from '@tauri-apps/api/path';
import { exists, remove, rename } from '@tauri-apps/plugin-fs';
import type { AtomicJsonFile, JsonFileDirectory } from '../persistence/json-file';
import { TauriJsonFile } from './tauri-json-file';

export class TauriJsonDirectory implements JsonFileDirectory {
  file(name: string): AtomicJsonFile {
    return new TauriJsonFile(name);
  }

  async exists(name: string): Promise<boolean> {
    return exists(await this.path(name));
  }

  async rename(from: string, to: string): Promise<void> {
    await rename(await this.path(from), await this.path(to));
  }

  async remove(name: string): Promise<void> {
    await remove(await this.path(name));
  }

  private async path(name: string): Promise<string> {
    return join(await appConfigDir(), name);
  }
}
