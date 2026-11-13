import type { DailyUsageReader } from '../../application/ports';
import type { ModelTokens, RawDailyUsage, RawDailyUsageDay } from '../../domain/usage';
import { SECOND_MS } from '../../domain/time';
import type { TauriCommands } from './tauri-commands';

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function toModelTokens(raw: unknown): ModelTokens | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const model = record['model'];
  return typeof model === 'string' && model !== '' ? { model, tokens: count(record['tokens']) } : null;
}

function toDay(raw: unknown): RawDailyUsageDay | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const start = record['start'];
  if (typeof start !== 'number' || !Number.isFinite(start)) return null;
  const models = Array.isArray(record['models']) ? record['models'] : [];
  const peaks = Array.isArray(record['contextPeaks']) ? record['contextPeaks'] : [];
  return {
    start: start * SECOND_MS,
    models: models.map(toModelTokens).filter((entry): entry is ModelTokens => entry !== null),
    sessions: count(record['sessions']),
    contextPeaks: peaks.map(count).filter((peak) => peak > 0),
  };
}

export function toRawDailyUsage(raw: unknown): RawDailyUsage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record['days'])) return null;
  const days = record['days'].map(toDay).filter((day): day is RawDailyUsageDay => day !== null);
  return { complete: record['complete'] !== false, days };
}

export class TauriDailyUsageReader implements DailyUsageReader {
  constructor(private readonly commands: TauriCommands) {}

  async read(dayStarts: readonly number[]): Promise<RawDailyUsage | null> {
    const seconds = dayStarts.map((start) => Math.floor(start / SECOND_MS));
    return toRawDailyUsage(await this.commands.call<unknown>('daily_usage', { dayStarts: seconds }));
  }
}
