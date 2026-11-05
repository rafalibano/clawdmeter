import { homeDir, join } from '@tauri-apps/api/path';
import { readTextFile, stat } from '@tauri-apps/plugin-fs';
import type { ExternalUsageHistorySource } from '../../application/ports';
import { parseClaudeUsageBarHistory, type ExternalUsagePoint } from '../../domain/usage';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export class TauriClaudeUsageBarHistorySource implements ExternalUsageHistorySource {
  async read(): Promise<ExternalUsagePoint[]> {
    try {
      const path = await join(await homeDir(), '.config', 'claude-usage-bar', 'history.json');
      if ((await stat(path)).size > MAX_FILE_BYTES) return [];
      const text = await readTextFile(path);
      if (text.length > MAX_FILE_BYTES) return [];
      return parseClaudeUsageBarHistory(JSON.parse(text));
    } catch {
      return [];
    }
  }
}
