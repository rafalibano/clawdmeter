import { mergeExternalPoints, type UsageHistory } from '../../../domain/usage';
import type { ExternalUsageHistorySource } from '../../ports';

export interface ImportOutcome {
  history: UsageHistory;
  importedAt: number | null;
}

function hasImportedPoints(history: UsageHistory): boolean {
  return [...history.fiveHour, ...history.sevenDay].some((point) => point.imported === true);
}

export class ImportExternalUsageHistory {
  constructor(private readonly source: ExternalUsageHistorySource) {}

  async execute(history: UsageHistory, importedAt: number | null, now: number): Promise<ImportOutcome> {
    if (importedAt !== null) return { history, importedAt };
    if (hasImportedPoints(history)) return { history, importedAt: now };
    try {
      return { history: mergeExternalPoints(history, await this.source.read(), now), importedAt: now };
    } catch {
      return { history, importedAt: null };
    }
  }
}
