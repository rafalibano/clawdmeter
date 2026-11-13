import { DAY_MS } from '../../../domain/time';
import { shortModel } from '../../../domain/sessions';
import { hasDailyActivity, type DailyUsage, type DailyUsageDay } from '../../../domain/usage';
import type { Localizer } from '../../i18n';
import { compactTokens } from '../sessions/sessions-view';

export interface DailyModelView {
  model: string;
  tokens: string;
}

export interface DailyDayView {
  key: number;
  label: string;
  total: string;
  sessions: string;
  context: string | null;
  models: DailyModelView[];
  idle: boolean;
}

export interface DailyShareView {
  model: string;
  percent: string;
  fill: number;
}

export interface DailyView {
  empty: boolean;
  shares: DailyShareView[];
  days: DailyDayView[];
}

function dayLabel(start: number, now: number, l: Localizer): string {
  const today = new Date(now);
  const day = new Date(start);
  const sameDay = (other: Date) => day.toDateString() === other.toDateString();
  if (sameDay(today)) return l.t('usage.daily.today');
  if (sameDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))) return l.t('usage.daily.yesterday');
  return `${l.weekday(start)} ${l.axisTick(start, 2 * DAY_MS)}`;
}

function toDayView(day: DailyUsageDay, now: number, l: Localizer): DailyDayView {
  return {
    key: day.start,
    label: dayLabel(day.start, now, l),
    total: compactTokens(day.totalTokens, l),
    sessions: l.count('sessions.count', day.sessions),
    context: day.averageContext === null ? null : l.t('usage.daily.context', { value: compactTokens(day.averageContext, l) }),
    models: day.models.map((entry) => ({ model: shortModel(entry.model) ?? entry.model, tokens: compactTokens(entry.tokens, l) })),
    idle: day.totalTokens === 0 && day.sessions === 0,
  };
}

function percentText(percent: number, l: Localizer): string {
  return percent < 1 ? l.t('usage.daily.lessThanOne') : `${Math.round(percent)}%`;
}

export function toDailyView(usage: DailyUsage, now: number, l: Localizer): DailyView {
  return {
    empty: !hasDailyActivity(usage),
    shares: usage.modelShare.map((entry) => ({
      model: shortModel(entry.model) ?? entry.model,
      percent: percentText(entry.percent, l),
      fill: Math.min(100, Math.max(0, entry.percent)),
    })),
    days: usage.days.map((day) => toDayView(day, now, l)),
  };
}
