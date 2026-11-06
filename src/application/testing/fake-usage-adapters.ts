import {
  createEmptyHistory,
  type ExternalUsagePoint,
  type UsageHistory,
  type UsageSnapshot,
} from '../../domain/usage';
import type {
  ExternalUsageHistorySource,
  ProcessProbe,
  SessionDirectory,
  UsageGateway,
  UsageHistoryStore,
  UsageHistoryStores,
  UsageIndicator,
} from '../ports';

export const SAMPLE_SNAPSHOT: UsageSnapshot = {
  fiveHour: { utilization: 20, resetsAt: 1_800_000_000_000 + 3_600_000 },
  sevenDay: { utilization: 10, resetsAt: 1_800_000_000_000 + 86_400_000 },
};

export class FakeUsageGateway implements UsageGateway {
  outcome: UsageSnapshot | Error = SAMPLE_SNAPSHOT;
  fetches = 0;
  readonly requests: { accountId: string; clientId: string }[] = [];

  async fetch(accountId: string, clientId: string): Promise<UsageSnapshot> {
    this.fetches += 1;
    this.requests.push({ accountId, clientId });
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

export class FakeUsageIndicator implements UsageIndicator {
  readonly updates: { snapshot: UsageSnapshot | null; now: number }[] = [];
  failure: Error | null = null;

  async update(snapshot: UsageSnapshot | null, now: number): Promise<void> {
    this.updates.push({ snapshot, now });
    if (this.failure) throw this.failure;
  }
}

export class FakeUsageHistoryStore implements UsageHistoryStore {
  saved: UsageHistory[] = [];

  constructor(
    public current: UsageHistory = createEmptyHistory(),
    public imported: number | null = null,
  ) {}

  async load(): Promise<UsageHistory> {
    return this.current;
  }

  async save(history: UsageHistory): Promise<void> {
    this.current = history;
    this.saved.push(history);
  }

  async importedAt(): Promise<number | null> {
    return this.imported;
  }

  async markImported(at: number): Promise<void> {
    this.imported = at;
  }
}

export class FakeUsageHistoryStores implements UsageHistoryStores {
  readonly stores = new Map<string, FakeUsageHistoryStore>();
  readonly removed: string[] = [];

  constructor(public legacy: FakeUsageHistoryStore | null = null) {}

  forAccount(accountId: string): FakeUsageHistoryStore {
    const known = this.stores.get(accountId);
    if (known !== undefined) return known;
    const created = new FakeUsageHistoryStore();
    this.stores.set(accountId, created);
    return created;
  }

  async adoptLegacy(accountId: string): Promise<boolean> {
    if (this.legacy === null || this.stores.has(accountId)) return false;
    this.stores.set(accountId, this.legacy);
    this.legacy = null;
    return true;
  }

  async releaseLegacy(accountId: string): Promise<void> {
    const adopted = this.stores.get(accountId);
    if (this.legacy !== null || adopted === undefined) return;
    this.legacy = adopted;
    this.stores.delete(accountId);
  }

  async remove(accountId: string): Promise<void> {
    this.removed.push(accountId);
    this.stores.delete(accountId);
  }
}

export class FakeExternalUsageHistorySource implements ExternalUsageHistorySource {
  reads = 0;

  constructor(public outcome: ExternalUsagePoint[] | Error = []) {}

  async read(): Promise<ExternalUsagePoint[]> {
    this.reads += 1;
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

export class FakeSessionDirectory implements SessionDirectory {
  files: string[] = [];

  async readAll(): Promise<string[]> {
    return this.files;
  }
}

export class FakeProcessProbe implements ProcessProbe {
  alive = new Set<number>();
  readonly probed: number[] = [];

  async isAlive(pid: number): Promise<boolean> {
    this.probed.push(pid);
    return this.alive.has(pid);
  }
}
