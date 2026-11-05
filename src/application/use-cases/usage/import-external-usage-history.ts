import { mergeExternalPoints, type UsageHistory } from '../../../domain/usage';
import type { ExternalUsageHistorySource } from '../../ports';

export class ImportExternalUsageHistory {
  constructor(private readonly source: ExternalUsageHistorySource) {}

  async execute(history: UsageHistory, now: number): Promise<UsageHistory> {
    try {
      return mergeExternalPoints(history, await this.source.read(), now);
    } catch {
      return history;
    }
  }
}
