import { beforeEach, describe, expect, it } from 'vitest';
import type { AtomicJsonFile, JsonFileDirectory } from './json-file';
import { JsonUsageHistoryStores, LEGACY_USAGE_HISTORY_FILE, usageHistoryFileName } from './json-usage-history-stores';

class MemoryDirectory implements JsonFileDirectory {
  readonly files = new Map<string, string>();
  readonly renames: Array<[string, string]> = [];

  file(name: string): AtomicJsonFile {
    const files = this.files;
    return {
      read: async () => files.get(name) ?? null,
      write: async (text) => void files.set(name, text),
      writeAtomic: async (text) => void files.set(name, text),
      quarantine: async () => void files.delete(name),
      watch: async () => () => undefined,
    };
  }

  async exists(name: string): Promise<boolean> {
    return this.files.has(name);
  }

  async rename(from: string, to: string): Promise<void> {
    const text = this.files.get(from);
    if (text === undefined) throw new Error(`missing ${from}`);
    this.files.delete(from);
    this.files.set(to, text);
    this.renames.push([from, to]);
  }

  async remove(name: string): Promise<void> {
    this.files.delete(name);
  }
}

const START = 1_800_000_000_000;
const LEGACY = JSON.stringify({
  fiveHour: [[START - 60_000, 12, null]],
  sevenDay: [[START - 60_000, 4, null]],
  claudeUsageBarImportedAt: START - 1,
});

let directory: MemoryDirectory;
let stores: JsonUsageHistoryStores;

beforeEach(() => {
  directory = new MemoryDirectory();
  stores = new JsonUsageHistoryStores(directory);
});

describe('JsonUsageHistoryStores', () => {
  it('one file per account, named after the account id', async () => {
    expect(usageHistoryFileName('account-1')).toBe('usage-history.account-1.json');
    await stores.forAccount('account-1').save({ fiveHour: [{ at: START, utilization: 5, resetsAt: null }], sevenDay: [] });
    await stores.forAccount('account-2').save({ fiveHour: [], sevenDay: [] });
    expect([...directory.files.keys()].sort()).toEqual(['usage-history.account-1.json', 'usage-history.account-2.json']);
    expect(stores.forAccount('account-1')).toBe(stores.forAccount('account-1'));
  });

  it('refuses an id that could escape the file name', () => {
    expect(() => stores.forAccount('../settings')).toThrow('Invalid account id');
    expect(() => usageHistoryFileName('a/b')).toThrow();
  });

  it('the first account adopts the legacy file, keeping its points and the import marker', async () => {
    directory.files.set(LEGACY_USAGE_HISTORY_FILE, LEGACY);
    expect(await stores.adoptLegacy('account-1')).toBe(true);
    expect(directory.files.has(LEGACY_USAGE_HISTORY_FILE)).toBe(false);
    const store = stores.forAccount('account-1');
    expect((await store.load()).fiveHour).toEqual([{ at: START - 60_000, utilization: 12, resetsAt: null }]);
    expect(await store.importedAt()).toBe(START - 1);
  });

  it('never overwrites a file the account already has, and does nothing without a legacy file', async () => {
    directory.files.set(LEGACY_USAGE_HISTORY_FILE, LEGACY);
    directory.files.set('usage-history.account-1.json', '{"fiveHour":[],"sevenDay":[]}');
    expect(await stores.adoptLegacy('account-1')).toBe(false);
    expect(directory.files.get(LEGACY_USAGE_HISTORY_FILE)).toBe(LEGACY);
    expect(await stores.adoptLegacy('account-2')).toBe(true);
    expect(await stores.adoptLegacy('account-3')).toBe(false);
    expect(directory.renames).toEqual([[LEGACY_USAGE_HISTORY_FILE, 'usage-history.account-2.json']]);
  });

  it('releasing gives the adopted file back to the legacy name', async () => {
    directory.files.set(LEGACY_USAGE_HISTORY_FILE, LEGACY);
    await stores.adoptLegacy('account-1');
    await stores.releaseLegacy('account-1');
    expect(directory.files.get(LEGACY_USAGE_HISTORY_FILE)).toBe(LEGACY);
    expect(directory.files.has('usage-history.account-1.json')).toBe(false);
  });

  it('removing an account deletes its file and ignores late writes of the old store', async () => {
    const store = stores.forAccount('account-1');
    await store.save({ fiveHour: [], sevenDay: [] });
    await stores.remove('account-1');
    expect(directory.files.has('usage-history.account-1.json')).toBe(false);
    await store.save({ fiveHour: [{ at: START, utilization: 1, resetsAt: null }], sevenDay: [] });
    expect(directory.files.has('usage-history.account-1.json')).toBe(false);
    expect(stores.forAccount('account-1')).not.toBe(store);
  });

  it('removing an account without a file is fine', async () => {
    await expect(stores.remove('account-9')).resolves.toBeUndefined();
  });
});
