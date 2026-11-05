import { describe, expect, it } from 'vitest';
import { buildAgenda, meetingsOfDay } from './agenda';
import { teamsJoinUrl } from './join-url';
import type { Meeting } from './meeting';
import {
  CALENDAR_TIME_ZONE,
  dayBounds,
  formatClock,
  isValidTimeZone,
  parseWallClock,
  startOfDay,
  zonedTimeToEpoch,
} from './time-zone';

const SP = CALENDAR_TIME_ZONE;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function at(iso: string): number {
  return Date.parse(iso);
}

function meeting(overrides: Partial<Meeting> & Pick<Meeting, 'startsAt' | 'endsAt'>): Meeting {
  return {
    id: String(overrides.startsAt),
    title: 'Meeting',
    allDay: false,
    cancelled: false,
    showAs: 'busy',
    organizer: null,
    location: null,
    joinUrl: null,
    ...overrides,
  };
}

describe('time zone and day bounds', () => {
  it('the day in São Paulo runs from 00:00 to 23:59:59 local (UTC-3)', () => {
    const bounds = dayBounds(at('2026-11-05T15:00:00Z'), SP);
    expect(bounds.startsAt).toBe(at('2026-11-05T03:00:00Z'));
    expect(bounds.endsAt).toBe(at('2026-11-06T02:59:59Z'));
  });

  it('day rollover: 23:59:59 local is still today, 00:00:00 local is already the next day', () => {
    const lastSecond = at('2026-11-06T02:59:59Z');
    const firstSecond = at('2026-11-06T03:00:00Z');
    expect(dayBounds(lastSecond, SP).startsAt).toBe(at('2026-11-05T03:00:00Z'));
    expect(dayBounds(firstSecond, SP).startsAt).toBe(at('2026-11-06T03:00:00Z'));
    expect(startOfDay(at('2026-11-06T02:00:00Z'), SP)).toBe(at('2026-11-05T03:00:00Z'));
  });

  it('month and year rollover', () => {
    expect(dayBounds(at('2026-12-31T20:00:00Z'), SP).endsAt).toBe(at('2027-01-01T02:59:59Z'));
  });

  it('the same instant falls on different days depending on the time zone', () => {
    const instant = at('2026-11-05T01:30:00Z');
    expect(dayBounds(instant, SP).startsAt).toBe(at('2026-11-04T03:00:00Z'));
    expect(dayBounds(instant, 'UTC').startsAt).toBe(at('2026-11-05T00:00:00Z'));
  });

  it('honors daylight saving time in zones that have it', () => {
    const ny = 'America/New_York';
    expect(zonedTimeToEpoch({ year: 2026, month: 7, day: 1, hour: 9, minute: 0, second: 0 }, ny)).toBe(at('2026-07-01T13:00:00Z'));
    expect(zonedTimeToEpoch({ year: 2026, month: 12, day: 1, hour: 9, minute: 0, second: 0 }, ny)).toBe(at('2026-12-01T14:00:00Z'));
    const springForward = dayBounds(at('2026-03-08T18:00:00Z'), ny);
    expect(springForward.endsAt - springForward.startsAt).toBe(23 * HOUR - 1000);
  });

  it('reads Graph dates without an offset in the requested zone and with an offset as they are', () => {
    expect(parseWallClock('2026-11-05T09:30:00.0000000', SP)).toBe(at('2026-11-05T12:30:00Z'));
    expect(parseWallClock('2026-11-05T09:30:00', 'UTC')).toBe(at('2026-11-05T09:30:00Z'));
    expect(parseWallClock('2026-11-05T09:30:00-03:00', 'UTC')).toBe(at('2026-11-05T12:30:00Z'));
    expect(parseWallClock('2026-11-05T09:30:00.0000000Z', SP)).toBe(at('2026-11-05T09:30:00Z'));
    expect(parseWallClock('garbage', SP)).toBeNull();
  });

  it('formats the local time and validates time zone names', () => {
    expect(formatClock(at('2026-11-05T12:05:00Z'), SP)).toBe('09:05');
    expect(formatClock(at('2026-11-05T03:00:00Z'), SP)).toBe('00:00');
    expect(isValidTimeZone(SP)).toBe(true);
    expect(isValidTimeZone('E. South America Standard Time')).toBe(false);
  });
});

describe('meetingsOfDay', () => {
  const day = dayBounds(at('2026-11-05T15:00:00Z'), SP);

  it('keeps what starts on the day and what crosses midnight into it', () => {
    const inside = meeting({ startsAt: day.startsAt + 9 * HOUR, endsAt: day.startsAt + 10 * HOUR });
    const crossing = meeting({ startsAt: day.startsAt - HOUR, endsAt: day.startsAt + 30 * MINUTE });
    expect(meetingsOfDay([inside, crossing], day)).toEqual([inside, crossing]);
  });

  it('drops what ended exactly at midnight and what starts on the next day', () => {
    const endedAtMidnight = meeting({ startsAt: day.startsAt - HOUR, endsAt: day.startsAt });
    const tomorrow = meeting({ startsAt: day.endsAt + 1000, endsAt: day.endsAt + HOUR });
    expect(meetingsOfDay([endedAtMidnight, tomorrow], day)).toEqual([]);
  });

  it('yesterday all-day events disappear and today ones stay', () => {
    const yesterday = meeting({ allDay: true, startsAt: day.startsAt - 24 * HOUR, endsAt: day.startsAt });
    const today = meeting({ allDay: true, startsAt: day.startsAt, endsAt: day.startsAt + 24 * HOUR });
    expect(meetingsOfDay([yesterday, today], day)).toEqual([today]);
  });
});

describe('buildAgenda', () => {
  const base = at('2026-11-05T12:00:00Z');
  const past = meeting({ title: 'Passada', startsAt: base - 2 * HOUR, endsAt: base - HOUR });
  const running = meeting({ title: 'Agora', startsAt: base - 10 * MINUTE, endsAt: base + 20 * MINUTE });
  const soon = meeting({ title: 'Soon', startsAt: base + 45 * MINUTE, endsAt: base + 75 * MINUTE });
  const later = meeting({ title: 'Depois', startsAt: base + 3 * HOUR, endsAt: base + 4 * HOUR });

  it('classifies past, ongoing and upcoming, sorted by start', () => {
    const agenda = buildAgenda([later, soon, running, past], base);
    expect(agenda.timed.map((item) => [item.meeting.title, item.phase])).toEqual([
      ['Passada', 'past'],
      ['Agora', 'now'],
      ['Soon', 'upcoming'],
      ['Depois', 'upcoming'],
    ]);
    expect(agenda.current.map((item) => item.title)).toEqual(['Agora']);
    expect(agenda.next).toEqual({ meeting: soon, minutesUntil: 45 });
  });

  it('the start instant already counts as ongoing and the end instant as finished', () => {
    expect(buildAgenda([soon], soon.startsAt).timed[0]?.phase).toBe('now');
    expect(buildAgenda([soon], soon.endsAt).timed[0]?.phase).toBe('past');
  });

  it('rounds minutes up and disappears when there is no next meeting', () => {
    expect(buildAgenda([soon], soon.startsAt - 30_001).next?.minutesUntil).toBe(1);
    expect(buildAgenda([past, running], base).next).toBeNull();
  });

  it('cancelled stays in the list, but is never "now" or "next"', () => {
    const cancelled = meeting({ title: 'Cancelada', startsAt: base - 5 * MINUTE, endsAt: base + 10 * MINUTE, cancelled: true });
    const cancelledNext = meeting({ title: 'Cancelada 2', startsAt: base + 5 * MINUTE, endsAt: base + 20 * MINUTE, cancelled: true });
    const agenda = buildAgenda([cancelled, cancelledNext, later], base);
    expect(agenda.timed.map((item) => item.phase)).toEqual(['cancelled', 'cancelled', 'upcoming']);
    expect(agenda.current).toEqual([]);
    expect(agenda.next?.meeting.title).toBe('Depois');
  });

  it('all-day goes in its own list and never becomes "now" or "next"', () => {
    const day = dayBounds(base, SP);
    const holiday = meeting({ title: 'Feriado', allDay: true, startsAt: day.startsAt, endsAt: day.endsAt + 1000 });
    const agenda = buildAgenda([holiday], base);
    expect(agenda.allDay.map((item) => item.meeting.title)).toEqual(['Feriado']);
    expect(agenda.timed).toEqual([]);
    expect(agenda.current).toEqual([]);
    expect(agenda.next).toBeNull();
  });

  it('a meeting that crosses midnight stays "now" after the rollover', () => {
    const late = meeting({ startsAt: at('2026-11-06T01:30:00Z'), endsAt: at('2026-11-06T03:30:00Z') });
    expect(buildAgenda([late], at('2026-11-06T03:10:00Z')).current).toEqual([late]);
    expect(buildAgenda([late], at('2026-11-06T03:30:00Z')).current).toEqual([]);
  });
});

describe('teamsJoinUrl', () => {
  it('accepts https on teams.microsoft.com and teams.live.com', () => {
    expect(teamsJoinUrl('https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=x')).toBe(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=x',
    );
    expect(teamsJoinUrl('https://teams.live.com/meet/9300000000')).toBe('https://teams.live.com/meet/9300000000');
  });

  it.each([
    'http://teams.microsoft.com/l/meetup-join/x',
    'https://evil.example.com/teams.microsoft.com',
    'https://teams.microsoft.com.evil.example.com/x',
    'https://sub.teams.microsoft.com/x',
    'https://teams.microsoft.com@evil.example.com/x',
    'https://user:pass@teams.microsoft.com/x',
    'https://teams.microsoft.com:8443/x',
    'javascript:alert(1)',
    'msteams://teams.microsoft.com/l/meetup-join/x',
    'file:///etc/passwd',
    'not a url',
    '',
  ])('rejeita %s', (raw) => {
    expect(teamsJoinUrl(raw)).toBeNull();
  });

  it('rejects null and undefined', () => {
    expect(teamsJoinUrl(null)).toBeNull();
    expect(teamsJoinUrl(undefined)).toBeNull();
  });
});
