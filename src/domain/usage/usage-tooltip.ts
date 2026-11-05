import type { UsageSnapshot, UsageWindowReading } from './usage-snapshot';

export const USAGE_UNAVAILABLE_TOOLTIP = 'Dev Pulse · usage indisponível';

function dayKey(at: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(at);
}

function formatReset(resetsAt: number, now: number, timeZone: string | undefined): string {
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(resetsAt);
  if (dayKey(resetsAt, timeZone) === dayKey(now, timeZone)) return `reseta ${time}`;
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone }).format(resetsAt).replace('.', '');
  return `reseta ${weekday} ${time}`;
}

function describeWindow(label: string, reading: UsageWindowReading | null, now: number, timeZone: string | undefined): string {
  if (reading === null) return `${label}: sem dado`;
  const percent = `${label}: ${Math.round(reading.utilization)}%`;
  return reading.resetsAt === null ? percent : `${percent} · ${formatReset(reading.resetsAt, now, timeZone)}`;
}

export function describeUsageTooltip(snapshot: UsageSnapshot | null, now: number, timeZone?: string): string {
  if (snapshot === null) return USAGE_UNAVAILABLE_TOOLTIP;
  return [
    describeWindow('5h', snapshot.fiveHour, now, timeZone),
    describeWindow('7d', snapshot.sevenDay, now, timeZone),
  ].join(' | ');
}
