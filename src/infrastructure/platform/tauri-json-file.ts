import { appConfigDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, rename, watch, writeTextFile } from '@tauri-apps/plugin-fs';
import type { AtomicJsonFile } from '../persistence/json-file';

const WATCH_DEBOUNCE_MS = 150;

export class TauriJsonFile implements AtomicJsonFile {
  constructor(private readonly fileName: string) {}

  async read(): Promise<string | null> {
    const path = await this.path();
    return (await exists(path)) ? readTextFile(path) : null;
  }

  async write(text: string): Promise<void> {
    await mkdir(await appConfigDir(), { recursive: true });
    await writeTextFile(await this.path(), text);
  }

  async writeAtomic(text: string): Promise<void> {
    await mkdir(await appConfigDir(), { recursive: true });
    const target = await this.path();
    const temp = await this.siblingPath(`${this.fileName}.tmp`);
    await writeTextFile(temp, text);
    await rename(temp, target);
  }

  async quarantine(): Promise<void> {
    const target = await this.path();
    if (await exists(target)) await rename(target, await this.siblingPath(`${this.fileName}.corrupt`));
  }

  async watch(onChange: () => void): Promise<() => void> {
    await mkdir(await appConfigDir(), { recursive: true });
    return watch(
      await appConfigDir(),
      (event) => {
        if (event.paths.some((path) => this.isTarget(path))) onChange();
      },
      { recursive: false, delayMs: WATCH_DEBOUNCE_MS },
    );
  }

  private isTarget(path: string): boolean {
    return path.split(/[\\/]/).pop() === this.fileName;
  }

  private async path(): Promise<string> {
    return this.siblingPath(this.fileName);
  }

  private async siblingPath(name: string): Promise<string> {
    return join(await appConfigDir(), name);
  }
}
