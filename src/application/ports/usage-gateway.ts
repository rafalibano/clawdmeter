import type { UsageHistory, UsageSnapshot } from '../../domain/usage';

export interface UsageGateway {
  fetch(accessToken: string): Promise<UsageSnapshot>;
}

export interface UsageHistoryStore {
  load(): Promise<UsageHistory>;
  save(history: UsageHistory): Promise<void>;
}
