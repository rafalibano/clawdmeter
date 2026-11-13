export const DAILY_USAGE_DAYS = 7;

export interface ModelTokens {
  model: string;
  tokens: number;
}

export interface RawDailyUsageDay {
  start: number;
  models: ModelTokens[];
  sessions: number;
  contextPeaks: number[];
}

export interface RawDailyUsage {
  complete: boolean;
  days: RawDailyUsageDay[];
}

export interface DailyUsageDay {
  start: number;
  models: ModelTokens[];
  totalTokens: number;
  sessions: number;
  averageContext: number | null;
}

export interface ModelShare {
  model: string;
  tokens: number;
  percent: number;
}

export interface DailyUsage {
  days: DailyUsageDay[];
  modelShare: ModelShare[];
  totalTokens: number;
}

export function localDayStarts(now: number, days: number): number[] {
  const today = new Date(now);
  return Array.from({ length: days + 1 }, (_, index) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1) + index).getTime(),
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function byTokensThenName(a: ModelTokens, b: ModelTokens): number {
  return b.tokens - a.tokens || a.model.localeCompare(b.model);
}

export function averageContext(peaks: readonly number[]): number | null {
  return peaks.length === 0 ? null : Math.round(sum(peaks) / peaks.length);
}

export function modelShare(days: readonly { models: readonly ModelTokens[] }[]): ModelShare[] {
  const totals = new Map<string, number>();
  for (const day of days) {
    for (const { model, tokens } of day.models) totals.set(model, (totals.get(model) ?? 0) + tokens);
  }
  const all = [...totals].map(([model, tokens]) => ({ model, tokens })).filter((entry) => entry.tokens > 0);
  const total = sum(all.map((entry) => entry.tokens));
  return all.sort(byTokensThenName).map((entry) => ({ ...entry, percent: (entry.tokens / total) * 100 }));
}

export function buildDailyUsage(raw: RawDailyUsage): DailyUsage {
  const days = raw.days
    .map((day): DailyUsageDay => {
      const models = day.models.filter((entry) => entry.tokens > 0).sort(byTokensThenName);
      return {
        start: day.start,
        models,
        totalTokens: sum(models.map((entry) => entry.tokens)),
        sessions: day.sessions,
        averageContext: averageContext(day.contextPeaks),
      };
    })
    .sort((a, b) => b.start - a.start);
  return { days, modelShare: modelShare(days), totalTokens: sum(days.map((day) => day.totalTokens)) };
}

export function hasDailyActivity(usage: DailyUsage): boolean {
  return usage.totalTokens > 0 || usage.days.some((day) => day.sessions > 0);
}
