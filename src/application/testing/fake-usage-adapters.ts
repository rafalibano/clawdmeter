import { createEmptyHistory, type UsageHistory, type UsageSnapshot } from '../../domain/usage';
import type { ProcessProbe, SessionDirectory, UsageGateway, UsageHistoryStore, UsageIndicator } from '../ports';

export const SAMPLE_SNAPSHOT: UsageSnapshot = {
  fiveHour: { utilization: 20, resetsAt: 1_800_000_000_000 + 3_600_000 },
  sevenDay: { utilization: 10, resetsAt: 1_800_000_000_000 + 86_400_000 },
};

export class FakeUsageGateway implements UsageGateway {
  outcome: UsageSnapshot | Error = SAMPLE_SNAPSHOT;
  readonly tokens: string[] = [];

  async fetch(accessToken: string): Promise<UsageSnapshot> {
    this.tokens.push(accessToken);
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

  constructor(public current: UsageHistory = createEmptyHistory()) {}

  async load(): Promise<UsageHistory> {
    return this.current;
  }

  async save(history: UsageHistory): Promise<void> {
    this.current = history;
    this.saved.push(history);
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
