import type { MessageArgs, Translator } from '../../application/ports';
import { DEFAULT_LANGUAGE, type AppLanguage } from '../../domain/settings';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../domain/time';
import { en, type MessageKey } from './en';
import { esMX } from './es-MX';
import { ptBR } from './pt-BR';

export type { MessageKey } from './en';
export type { MessageArgs } from '../../application/ports';

export const DICTIONARIES: Record<AppLanguage, Record<MessageKey, string>> = { 'pt-BR': ptBR, en, 'es-MX': esMX };

const LOCALES: Record<AppLanguage, string> = { 'pt-BR': 'pt-BR', en: 'en-US', 'es-MX': 'es-MX' };

const pad = (value: number) => String(value).padStart(2, '0');

export function interpolate(template: string, args?: MessageArgs): string {
  if (args === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in args ? String(args[name]) : match));
}

export function translate(language: AppLanguage, key: MessageKey, args?: MessageArgs): string {
  return interpolate(DICTIONARIES[language][key] ?? en[key], args);
}

export function hasMessage(key: string): key is MessageKey {
  return key in en;
}

export class Localizer implements Translator {
  readonly locale: string;

  constructor(readonly language: AppLanguage = DEFAULT_LANGUAGE) {
    this.locale = LOCALES[language];
  }

  t(key: MessageKey, args?: MessageArgs): string {
    return translate(this.language, key, args);
  }

  count(base: 'sessions.count' | 'sessions.flagged', count: number): string {
    const key = new Intl.PluralRules(this.locale).select(count) === 'one' ? `${base}.one` : `${base}.other`;
    return this.t(key as MessageKey, { count });
  }

  number(value: number, maximumFractionDigits = 2): string {
    return new Intl.NumberFormat(this.locale, { maximumFractionDigits }).format(value);
  }

  cost(usd: number): string {
    return `US$ ${new Intl.NumberFormat(this.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usd)}`;
  }

  budget(usd: number): string {
    return `US$ ${this.number(usd)}`;
  }

  clock(at: number, timeZone?: string): string {
    return new Intl.DateTimeFormat(this.locale, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(timeZone === undefined ? {} : { timeZone }),
    }).format(at);
  }

  weekday(at: number, timeZone?: string): string {
    return new Intl.DateTimeFormat(this.locale, { weekday: 'short', ...(timeZone === undefined ? {} : { timeZone }) })
      .format(at)
      .replace('.', '')
      .toLowerCase();
  }

  dayClock(at: number, now: number): string {
    const same = new Date(at).toDateString() === new Date(now).toDateString();
    return same ? this.clock(at) : `${this.weekday(at)} ${this.clock(at)}`;
  }

  axisTick(at: number, rangeMs: number): string {
    if (rangeMs <= DAY_MS) return this.clock(at);
    return new Intl.DateTimeFormat(this.locale, { day: '2-digit', month: '2-digit' }).format(at);
  }

  span(ms: number): string {
    const span = Math.max(0, ms);
    if (span < MINUTE_MS) return this.t('time.lessThanMinute');
    if (span < HOUR_MS) return `${Math.round(span / MINUTE_MS)} min`;
    if (span < DAY_MS) {
      const hours = Math.floor(span / HOUR_MS);
      const minutes = Math.round((span % HOUR_MS) / MINUTE_MS);
      if (minutes === 60) return `${hours + 1}h`;
      return minutes === 0 ? `${hours}h` : `${hours}h${pad(minutes)}`;
    }
    const days = Math.floor(span / DAY_MS);
    const hours = Math.round((span % DAY_MS) / HOUR_MS);
    return hours === 0 || hours === 24 ? `${hours === 24 ? days + 1 : days}d` : `${days}d${hours}h`;
  }

  since(ms: number): string {
    const span = Math.max(0, ms);
    return span < MINUTE_MS ? this.t('time.now') : this.t('time.ago', { span: this.span(span) });
  }

  countdown(minutes: number): string {
    if (minutes <= 0) return this.t('countdown.now');
    if (minutes < 60) return this.t('countdown.minutes', { n: minutes });
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? this.t('countdown.hours', { h: hours }) : this.t('countdown.hoursMinutes', { h: hours, m: rest });
  }

  updatedAgo(updatedAt: number | null, now: number): string {
    if (updatedAt === null) return this.t('shell.updated.waiting');
    const elapsed = Math.max(0, now - updatedAt);
    if (elapsed < MINUTE_MS) return this.t('shell.updated.seconds', { n: Math.floor(elapsed / 1_000) });
    if (elapsed < HOUR_MS) return this.t('shell.updated.minutes', { n: Math.floor(elapsed / MINUTE_MS) });
    return this.t('shell.updated.hours', { n: Math.floor(elapsed / HOUR_MS) });
  }
}

export function createLocalizer(language: AppLanguage): Localizer {
  return new Localizer(language);
}
