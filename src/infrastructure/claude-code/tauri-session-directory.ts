import { homeDir, join } from '@tauri-apps/api/path';
import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs';
import type { SessionDirectory } from '../../application/ports';

export class TauriSessionDirectory implements SessionDirectory {
  async readAll(): Promise<string[]> {
    const dir = await join(await homeDir(), '.claude', 'sessions');
    if (!(await exists(dir))) return [];
    const entries = await readDir(dir);
    const files = entries.filter((entry) => entry.isFile && entry.name.endsWith('.json'));
    const texts = await Promise.all(files.map((entry) => this.readOne(dir, entry.name)));
    return texts.filter((text): text is string => text !== null);
  }

  private async readOne(dir: string, name: string): Promise<string | null> {
    try {
      return await readTextFile(await join(dir, name));
    } catch {
      return null;
    }
  }
}
