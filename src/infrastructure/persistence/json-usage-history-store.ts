import type { UsageHistoryStore } from '../../application/ports';
import { createEmptyHistory, parseHistory, serializeHistory, type UsageHistory } from '../../domain/usage';
import type { JsonFile } from './json-file';

export class JsonUsageHistoryStore implements UsageHistoryStore {
  constructor(private readonly file: JsonFile) {}

  async load(): Promise<UsageHistory> {
    const text = await this.file.read();
    if (text === null) return createEmptyHistory();
    try {
      return parseHistory(JSON.parse(text));
    } catch {
      return createEmptyHistory();
    }
  }

  async save(history: UsageHistory): Promise<void> {
    await this.file.write(JSON.stringify(serializeHistory(history)));
  }
}
