import { appConfigDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, watch, writeTextFile } from '@tauri-apps/plugin-fs';
import type { JsonFile } from '../persistence/json-file';

const WATCH_DEBOUNCE_MS = 150;

export class TauriJsonFile implements JsonFile {
  constructor(private readonly fileName: string) {}

  async read(): Promise<string | null> {
    const path = await this.path();
    return (await exists(path)) ? readTextFile(path) : null;
  }

  async write(text: string): Promise<void> {
    await mkdir(await appConfigDir(), { recursive: true });
    await writeTextFile(await this.path(), text);
  }

  async watch(onChange: () => void): Promise<() => void> {
    await mkdir(await appConfigDir(), { recursive: true });
    return watch(
      await appConfigDir(),
      (event) => {
        if (event.paths.some((path) => path.endsWith(this.fileName))) onChange();
      },
      { recursive: false, delayMs: WATCH_DEBOUNCE_MS },
    );
  }

  private async path(): Promise<string> {
    return join(await appConfigDir(), this.fileName);
  }
}
