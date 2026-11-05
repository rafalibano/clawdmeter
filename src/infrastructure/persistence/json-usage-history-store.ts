import type { UsageHistoryStore } from '../../application/ports';
import { createEmptyHistory, parseHistory, serializeHistory, type UsageHistory } from '../../domain/usage';
import type { AtomicJsonFile } from './json-file';

export class JsonUsageHistoryStore implements UsageHistoryStore {
  private loading: Promise<UsageHistory> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: AtomicJsonFile) {}

  load(): Promise<UsageHistory> {
    if (this.loading === null) {
      const loading = this.readFromDisk();
      this.loading = loading;
      loading.catch(() => {
        if (this.loading === loading) this.loading = null;
      });
    }
    return this.loading;
  }

  save(history: UsageHistory): Promise<void> {
    this.loading = Promise.resolve(history);
    const body = JSON.stringify(serializeHistory(history));
    const write = this.writing.then(() => this.file.writeAtomic(body));
    this.writing = write.catch(() => undefined);
    return write;
  }

  private async readFromDisk(): Promise<UsageHistory> {
    const text = await this.file.read();
    if (text === null) return createEmptyHistory();
    try {
      const raw: unknown = JSON.parse(text);
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('formato inesperado');
      return parseHistory(raw);
    } catch {
      await this.file.quarantine().catch(() => undefined);
      return createEmptyHistory();
    }
  }
}
