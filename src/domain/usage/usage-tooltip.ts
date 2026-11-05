import type { UsageSnapshot, UsageWindowReading } from './usage-snapshot';

export interface UsageTooltipTexts {
  locale: string;
  unavailable: string;
  noData(label: string): string;
  resets(when: string): string;
}

function dayKey(at: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(at);
}

function formatReset(resetsAt: number, now: number, texts: UsageTooltipTexts, timeZone: string | undefined): string {
  const time = new Intl.DateTimeFormat(texts.locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(resetsAt);
  if (dayKey(resetsAt, timeZone) === dayKey(now, timeZone)) return texts.resets(time);
  const weekday = new Intl.DateTimeFormat(texts.locale, { weekday: 'short', timeZone }).format(resetsAt).replace('.', '').toLowerCase();
  return texts.resets(`${weekday} ${time}`);
}

function describeWindow(
  label: string,
  reading: UsageWindowReading | null,
  now: number,
  texts: UsageTooltipTexts,
  timeZone: string | undefined,
): string {
  if (reading === null) return texts.noData(label);
  const percent = `${label}: ${Math.round(reading.utilization)}%`;
  return reading.resetsAt === null ? percent : `${percent} · ${formatReset(reading.resetsAt, now, texts, timeZone)}`;
}

export function describeUsageTooltip(
  snapshot: UsageSnapshot | null,
  now: number,
  texts: UsageTooltipTexts,
  timeZone?: string,
): string {
  if (snapshot === null) return texts.unavailable;
  return [
    describeWindow('5h', snapshot.fiveHour, now, texts, timeZone),
    describeWindow('7d', snapshot.sevenDay, now, texts, timeZone),
  ].join(' | ');
}
