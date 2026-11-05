import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../domain/time';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const pad = (value: number) => String(value).padStart(2, '0');

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatClock(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDayClock(at: number, now: number): string {
  const date = new Date(at);
  return sameDay(date, new Date(now)) ? formatClock(at) : `${WEEKDAYS[date.getDay()]} ${formatClock(at)}`;
}

export function formatAxisTick(at: number, rangeMs: number): string {
  if (rangeMs <= DAY_MS) return formatClock(at);
  const date = new Date(at);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

export function formatSpan(ms: number): string {
  const span = Math.max(0, ms);
  if (span < MINUTE_MS) return 'menos de 1 min';
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

export function formatSince(ms: number): string {
  const span = Math.max(0, ms);
  if (span < MINUTE_MS) return 'agora';
  return `há ${formatSpan(span)}`;
}
