import type { RawDailyUsage } from '../../domain/usage';

export interface DailyUsageReader {
  read(dayStarts: readonly number[]): Promise<RawDailyUsage | null>;
}
