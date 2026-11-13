import { DAILY_USAGE_DAYS, buildDailyUsage, localDayStarts, type DailyUsage } from '../../../domain/usage';
import type { Clock, DailyUsageReader, SettingsStore } from '../../ports';

const MAX_PASSES = 8;

export class LoadDailyUsage {
  constructor(
    private readonly settings: Pick<SettingsStore, 'load'>,
    private readonly reader: DailyUsageReader,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<DailyUsage | null> {
    if (!(await this.settings.load()).usageDailyHistory) return null;
    const dayStarts = localDayStarts(this.clock.now(), DAILY_USAGE_DAYS);
    for (let pass = 1; ; pass++) {
      const raw = await this.reader.read(dayStarts);
      if (raw === null) return null;
      if (raw.complete || pass >= MAX_PASSES) return buildDailyUsage(raw);
    }
  }
}
