import type { DailyUsageReader } from '../../application/ports';
import type { RawDailyUsage, RawDailyUsageDay } from '../../domain/usage';

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';

const PATTERN: ReadonlyArray<{ models: Array<[string, number]>; peaks: number[] }> = [
  { models: [[OPUS, 86_400_000], [HAIKU, 4_200_000]], peaks: [412_000, 905_000, 88_000] },
  { models: [[OPUS, 212_000_000], [SONNET, 38_000_000], [HAIKU, 9_500_000]], peaks: [640_000, 310_000, 120_000, 95_000, 770_000] },
  { models: [], peaks: [] },
  { models: [[SONNET, 24_000_000]], peaks: [210_000, 54_000] },
  { models: [[OPUS, 340_000], [HAIKU, 12_000]], peaks: [18_000] },
  { models: [[OPUS, 148_000_000], [SONNET, 61_000_000]], peaks: [520_000, 280_000, 410_000] },
  { models: [[OPUS, 56_000_000], [HAIKU, 2_800_000]], peaks: [330_000, 140_000] },
];

export class DemoDailyUsageReader implements DailyUsageReader {
  async read(dayStarts: readonly number[]): Promise<RawDailyUsage> {
    const days = dayStarts.slice(0, -1).map((start, index): RawDailyUsageDay => {
      const pattern = PATTERN[(dayStarts.length - 2 - index) % PATTERN.length] ?? { models: [], peaks: [] };
      return {
        start,
        models: pattern.models.map(([model, tokens]) => ({ model, tokens })),
        sessions: pattern.peaks.length,
        contextPeaks: [...pattern.peaks],
      };
    });
    return { complete: true, days };
  }
}
