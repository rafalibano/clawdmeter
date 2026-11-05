import type { ExternalUsagePoint, UsageHistory, UsageSnapshot } from '../../domain/usage';

export interface UsageGateway {
  fetch(): Promise<UsageSnapshot>;
}

export interface UsageHistoryStore {
  load(): Promise<UsageHistory>;
  save(history: UsageHistory): Promise<void>;
}

export interface ExternalUsageHistorySource {
  read(): Promise<ExternalUsagePoint[]>;
}
