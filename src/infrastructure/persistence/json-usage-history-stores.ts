import type { UsageHistoryStores } from '../../application/ports';
import { isClaudeAccountId } from '../../domain/settings';
import type { JsonFileDirectory } from './json-file';
import { JsonUsageHistoryStore } from './json-usage-history-store';

export const LEGACY_USAGE_HISTORY_FILE = 'usage-history.json';

export function usageHistoryFileName(accountId: string): string {
  if (!isClaudeAccountId(accountId)) throw new Error(`Invalid account id: ${accountId}`);
  return `usage-history.${accountId}.json`;
}

export class JsonUsageHistoryStores implements UsageHistoryStores {
  private readonly stores = new Map<string, JsonUsageHistoryStore>();

  constructor(private readonly directory: JsonFileDirectory) {}

  forAccount(accountId: string): JsonUsageHistoryStore {
    const name = usageHistoryFileName(accountId);
    const known = this.stores.get(accountId);
    if (known !== undefined) return known;
    const created = new JsonUsageHistoryStore(this.directory.file(name));
    this.stores.set(accountId, created);
    return created;
  }

  async adoptLegacy(accountId: string): Promise<boolean> {
    const target = usageHistoryFileName(accountId);
    if (!(await this.directory.exists(LEGACY_USAGE_HISTORY_FILE)) || (await this.directory.exists(target))) return false;
    await this.forget(accountId);
    await this.directory.rename(LEGACY_USAGE_HISTORY_FILE, target);
    return true;
  }

  async releaseLegacy(accountId: string): Promise<void> {
    const source = usageHistoryFileName(accountId);
    if ((await this.directory.exists(LEGACY_USAGE_HISTORY_FILE)) || !(await this.directory.exists(source))) return;
    await this.forget(accountId);
    await this.directory.rename(source, LEGACY_USAGE_HISTORY_FILE);
  }

  async remove(accountId: string): Promise<void> {
    const name = usageHistoryFileName(accountId);
    await this.forget(accountId);
    if (await this.directory.exists(name)) await this.directory.remove(name);
  }

  private async forget(accountId: string): Promise<void> {
    const store = this.stores.get(accountId);
    this.stores.delete(accountId);
    await store?.dispose();
  }
}
