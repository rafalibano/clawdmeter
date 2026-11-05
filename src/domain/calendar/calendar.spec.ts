import { describe, expect, it } from 'vitest';
import { buildAgenda, meetingsOfDay } from './agenda';
import { formatCountdown } from './countdown';
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
    title: 'Reunião',
    allDay: false,
    cancelled: false,
    showAs: 'busy',
    organizer: null,
    location: null,
    joinUrl: null,
    ...overrides,
  };
}

describe('fuso e limites do dia', () => {
  it('o dia em São Paulo vai de 00:00 a 23:59:59 locais (UTC-3)', () => {
    const bounds = dayBounds(at('2026-11-05T15:00:00Z'), SP);
    expect(bounds.startsAt).toBe(at('2026-11-05T03:00:00Z'));
    expect(bounds.endsAt).toBe(at('2026-11-06T02:59:59Z'));
  });

  it('virada de dia: 23:59:59 local ainda é hoje, 00:00:00 local já é o dia seguinte', () => {
    const lastSecond = at('2026-11-06T02:59:59Z');
    const firstSecond = at('2026-11-06T03:00:00Z');
    expect(dayBounds(lastSecond, SP).startsAt).toBe(at('2026-11-05T03:00:00Z'));
    expect(dayBounds(firstSecond, SP).startsAt).toBe(at('2026-11-06T03:00:00Z'));
    expect(startOfDay(at('2026-11-06T02:00:00Z'), SP)).toBe(at('2026-11-05T03:00:00Z'));
  });

  it('virada de mês e de ano', () => {
    expect(dayBounds(at('2026-12-31T20:00:00Z'), SP).endsAt).toBe(at('2027-01-01T02:59:59Z'));
  });

  it('o mesmo instante cai em dias diferentes conforme o fuso', () => {
    const instant = at('2026-11-05T01:30:00Z');
    expect(dayBounds(instant, SP).startsAt).toBe(at('2026-11-04T03:00:00Z'));
    expect(dayBounds(instant, 'UTC').startsAt).toBe(at('2026-11-05T00:00:00Z'));
  });

  it('respeita horário de verão em fusos que o têm', () => {
    const ny = 'America/New_York';
    expect(zonedTimeToEpoch({ year: 2026, month: 7, day: 1, hour: 9, minute: 0, second: 0 }, ny)).toBe(at('2026-07-01T13:00:00Z'));
    expect(zonedTimeToEpoch({ year: 2026, month: 12, day: 1, hour: 9, minute: 0, second: 0 }, ny)).toBe(at('2026-12-01T14:00:00Z'));
    const springForward = dayBounds(at('2026-03-08T18:00:00Z'), ny);
    expect(springForward.endsAt - springForward.startsAt).toBe(23 * HOUR - 1000);
  });

  it('lê datas do Graph sem offset no fuso pedido e com offset como estão', () => {
    expect(parseWallClock('2026-11-05T09:30:00.0000000', SP)).toBe(at('2026-11-05T12:30:00Z'));
    expect(parseWallClock('2026-11-05T09:30:00', 'UTC')).toBe(at('2026-11-05T09:30:00Z'));
    expect(parseWallClock('2026-11-05T09:30:00-03:00', 'UTC')).toBe(at('2026-11-05T12:30:00Z'));
    expect(parseWallClock('2026-11-05T09:30:00.0000000Z', SP)).toBe(at('2026-11-05T09:30:00Z'));
    expect(parseWallClock('lixo', SP)).toBeNull();
  });

  it('formata o horário local e valida nomes de fuso', () => {
    expect(formatClock(at('2026-11-05T12:05:00Z'), SP)).toBe('09:05');
    expect(formatClock(at('2026-11-05T03:00:00Z'), SP)).toBe('00:00');
    expect(isValidTimeZone(SP)).toBe(true);
    expect(isValidTimeZone('E. South America Standard Time')).toBe(false);
  });
});

describe('meetingsOfDay', () => {
  const day = dayBounds(at('2026-11-05T15:00:00Z'), SP);

  it('mantém o que começa no dia e o que atravessa a meia-noite de entrada', () => {
    const inside = meeting({ startsAt: day.startsAt + 9 * HOUR, endsAt: day.startsAt + 10 * HOUR });
    const crossing = meeting({ startsAt: day.startsAt - HOUR, endsAt: day.startsAt + 30 * MINUTE });
    expect(meetingsOfDay([inside, crossing], day)).toEqual([inside, crossing]);
  });

  it('descarta o que terminou exatamente à meia-noite e o que começa no dia seguinte', () => {
    const endedAtMidnight = meeting({ startsAt: day.startsAt - HOUR, endsAt: day.startsAt });
    const tomorrow = meeting({ startsAt: day.endsAt + 1000, endsAt: day.endsAt + HOUR });
    expect(meetingsOfDay([endedAtMidnight, tomorrow], day)).toEqual([]);
  });

  it('dia inteiro de ontem some e o de hoje fica', () => {
    const yesterday = meeting({ allDay: true, startsAt: day.startsAt - 24 * HOUR, endsAt: day.startsAt });
    const today = meeting({ allDay: true, startsAt: day.startsAt, endsAt: day.startsAt + 24 * HOUR });
    expect(meetingsOfDay([yesterday, today], day)).toEqual([today]);
  });
});

describe('buildAgenda', () => {
  const base = at('2026-11-05T12:00:00Z');
  const past = meeting({ title: 'Passada', startsAt: base - 2 * HOUR, endsAt: base - HOUR });
  const running = meeting({ title: 'Agora', startsAt: base - 10 * MINUTE, endsAt: base + 20 * MINUTE });
  const soon = meeting({ title: 'Próxima', startsAt: base + 45 * MINUTE, endsAt: base + 75 * MINUTE });
  const later = meeting({ title: 'Depois', startsAt: base + 3 * HOUR, endsAt: base + 4 * HOUR });

  it('classifica passada, em andamento e futura, ordenando por início', () => {
    const agenda = buildAgenda([later, soon, running, past], base);
    expect(agenda.timed.map((item) => [item.meeting.title, item.phase])).toEqual([
      ['Passada', 'past'],
      ['Agora', 'now'],
      ['Próxima', 'upcoming'],
      ['Depois', 'upcoming'],
    ]);
    expect(agenda.current.map((item) => item.title)).toEqual(['Agora']);
    expect(agenda.next).toEqual({ meeting: soon, minutesUntil: 45 });
  });

  it('o instante de início já conta como em andamento e o de fim como encerrada', () => {
    expect(buildAgenda([soon], soon.startsAt).timed[0]?.phase).toBe('now');
    expect(buildAgenda([soon], soon.endsAt).timed[0]?.phase).toBe('past');
  });

  it('arredonda os minutos para cima e some quando não há próxima', () => {
    expect(buildAgenda([soon], soon.startsAt - 30_001).next?.minutesUntil).toBe(1);
    expect(buildAgenda([past, running], base).next).toBeNull();
  });

  it('cancelada fica na lista, mas nunca é "agora" nem "próxima"', () => {
    const cancelled = meeting({ title: 'Cancelada', startsAt: base - 5 * MINUTE, endsAt: base + 10 * MINUTE, cancelled: true });
    const cancelledNext = meeting({ title: 'Cancelada 2', startsAt: base + 5 * MINUTE, endsAt: base + 20 * MINUTE, cancelled: true });
    const agenda = buildAgenda([cancelled, cancelledNext, later], base);
    expect(agenda.timed.map((item) => item.phase)).toEqual(['cancelled', 'cancelled', 'upcoming']);
    expect(agenda.current).toEqual([]);
    expect(agenda.next?.meeting.title).toBe('Depois');
  });

  it('dia inteiro fica em lista própria e não vira "agora" nem "próxima"', () => {
    const day = dayBounds(base, SP);
    const holiday = meeting({ title: 'Feriado', allDay: true, startsAt: day.startsAt, endsAt: day.endsAt + 1000 });
    const agenda = buildAgenda([holiday], base);
    expect(agenda.allDay.map((item) => item.meeting.title)).toEqual(['Feriado']);
    expect(agenda.timed).toEqual([]);
    expect(agenda.current).toEqual([]);
    expect(agenda.next).toBeNull();
  });

  it('reunião que atravessa a meia-noite segue "agora" depois da virada', () => {
    const late = meeting({ startsAt: at('2026-11-06T01:30:00Z'), endsAt: at('2026-11-06T03:30:00Z') });
    expect(buildAgenda([late], at('2026-11-06T03:10:00Z')).current).toEqual([late]);
    expect(buildAgenda([late], at('2026-11-06T03:30:00Z')).current).toEqual([]);
  });
});

describe('formatCountdown', () => {
  it.each([
    [0, 'agora'],
    [-3, 'agora'],
    [1, 'em 1 min'],
    [59, 'em 59 min'],
    [60, 'em 1h'],
    [80, 'em 1h 20min'],
  ])('%i min vira "%s"', (minutes, label) => {
    expect(formatCountdown(minutes)).toBe(label);
  });
});

describe('teamsJoinUrl', () => {
  it('aceita https em teams.microsoft.com e teams.live.com', () => {
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
    'nao é url',
    '',
  ])('rejeita %s', (raw) => {
    expect(teamsJoinUrl(raw)).toBeNull();
  });

  it('rejeita null e undefined', () => {
    expect(teamsJoinUrl(null)).toBeNull();
    expect(teamsJoinUrl(undefined)).toBeNull();
  });
});
