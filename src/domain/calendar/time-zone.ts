export const CALENDAR_TIME_ZONE = 'America/Sao_Paulo';

const SECOND_MS = 1000;
const DAY_PARTS_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface DayBounds {
  startsAt: number;
  endsAt: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values['year'] ?? 0,
    month: values['month'] ?? 0,
    day: values['day'] ?? 0,
    hour: values['hour'] ?? 0,
    minute: values['minute'] ?? 0,
    second: values['second'] ?? 0,
  };
}

function utcOf(parts: ZonedParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function offsetAt(epochMs: number, timeZone: string): number {
  const flooredToSecond = Math.floor(epochMs / SECOND_MS) * SECOND_MS;
  return utcOf(zonedParts(epochMs, timeZone)) - flooredToSecond;
}

export function zonedTimeToEpoch(parts: ZonedParts, timeZone: string): number {
  const naive = utcOf(parts);
  const first = naive - offsetAt(naive, timeZone);
  return naive - offsetAt(first, timeZone);
}

export function startOfDay(epochMs: number, timeZone: string): number {
  const { year, month, day } = zonedParts(epochMs, timeZone);
  return zonedTimeToEpoch({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function dayBounds(epochMs: number, timeZone: string): DayBounds {
  const { year, month, day } = zonedParts(epochMs, timeZone);
  const startsAt = zonedTimeToEpoch({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
  const nextStart = zonedTimeToEpoch({ year, month, day: day + 1, hour: 0, minute: 0, second: 0 }, timeZone);
  return { startsAt, endsAt: nextStart - SECOND_MS };
}

export function parseWallClock(value: string, timeZone: string): number | null {
  const match = DAY_PARTS_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offset] = match;
  if (offset !== undefined) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return zonedTimeToEpoch(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    },
    timeZone,
  );
}

export function formatClock(epochMs: number, timeZone: string): string {
  const { hour, minute } = zonedParts(epochMs, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
