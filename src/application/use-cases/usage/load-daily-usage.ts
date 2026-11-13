import { DAILY_USAGE_DAYS, buildDailyUsage, localDayStarts, type DailyUsage } from '../../../domain/usage';
import type { Clock, DailyUsageReader } from '../../ports';

export const DAILY_USAGE_MAX_PASSES = 8;

export class LoadDailyUsage {
  constructor(
    private readonly reader: DailyUsageReader,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<DailyUsage | null> {
    const dayStarts = localDayStarts(this.clock.now(), DAILY_USAGE_DAYS);
    for (let pass = 1; ; pass++) {
      const raw = await this.reader.read(dayStarts);
      if (raw === null) return null;
      if (raw.complete || pass >= DAILY_USAGE_MAX_PASSES) return buildDailyUsage(raw);
    }
  }
}
