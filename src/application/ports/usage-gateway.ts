import type { ExternalUsagePoint, UsageHistory, UsageResets, UsageSnapshot } from '../../domain/usage';

export interface UsageGateway {
  fetch(accountId: string, clientId: string): Promise<UsageSnapshot>;
}

export interface UsageResetsGateway {
  fetch(accountId: string, clientId: string): Promise<UsageResets | null>;
}

export interface UsageHistoryStore {
  load(): Promise<UsageHistory>;
  save(history: UsageHistory): Promise<void>;
  importedAt(): Promise<number | null>;
  markImported(at: number): Promise<void>;
}

export interface UsageHistoryStores {
  forAccount(accountId: string): UsageHistoryStore;
  adoptLegacy(accountId: string): Promise<boolean>;
  releaseLegacy(accountId: string): Promise<void>;
  remove(accountId: string): Promise<void>;
}

export interface ExternalUsageHistorySource {
  read(): Promise<ExternalUsagePoint[]>;
}
