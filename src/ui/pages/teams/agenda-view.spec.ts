import { describe, expect, it } from 'vitest';
import type { AgendaSnapshot } from '../../../application/use-cases/calendar';
import { dayBounds, type Meeting } from '../../../domain/calendar';
import { Localizer } from '../../i18n';
import { isStale, toAgendaView as toAgendaViewWith } from './agenda-view';

const PT = new Localizer('pt-BR');
const toAgendaView = (snapshot: AgendaSnapshot, now: number) => toAgendaViewWith(snapshot, now, PT);

const ZONE = 'America/Sao_Paulo';
const NOW = Date.parse('2026-11-05T13:00:00Z');
const MIN = 60_000;
const JOIN = 'https://teams.microsoft.com/l/meetup-join/abc';

function meeting(id: string, startsAt: number, endsAt: number, extra: Partial<Meeting> = {}): Meeting {
  return { id, title: id, startsAt, endsAt, allDay: false, cancelled: false, showAs: 'busy', organizer: null, location: null, joinUrl: null, ...extra };
}

function snapshot(meetings: Meeting[]): AgendaSnapshot {
  return { meetings, day: dayBounds(NOW, ZONE), timeZone: ZONE };
}

describe('countdown by language', () => {
  it.each([
    [0, 'agora', 'now', 'ahora'],
    [-3, 'agora', 'now', 'ahora'],
    [1, 'em 1 min', 'in 1 min', 'en 1 min'],
    [59, 'em 59 min', 'in 59 min', 'en 59 min'],
    [60, 'em 1h', 'in 1h', 'en 1h'],
    [80, 'em 1h 20min', 'in 1h 20min', 'en 1h 20min'],
  ])('%i min', (minutes, pt, en, es) => {
    expect(PT.countdown(minutes)).toBe(pt);
    expect(new Localizer('en').countdown(minutes)).toBe(en);
    expect(new Localizer('es-MX').countdown(minutes)).toBe(es);
  });
});

describe('toAgendaView', () => {
  const past = meeting('Passada', NOW - 120 * MIN, NOW - 90 * MIN, { joinUrl: JOIN });
  const running = meeting('Daily do time', NOW - 5 * MIN, NOW + 10 * MIN, { joinUrl: JOIN, location: 'Sala 1', organizer: 'Fulano' });
  const next = meeting('1:1', NOW + 25 * MIN, NOW + 55 * MIN, { joinUrl: JOIN });
  const cancelled = meeting('Planejamento', NOW + 120 * MIN, NOW + 180 * MIN, { cancelled: true, joinUrl: JOIN });

  it('shows local time, "now" and "next in X min" badges and the headline', () => {
    const view = toAgendaView(snapshot([next, running, past]), NOW);
    expect(view.headline).toBe('Agora: Daily do time');
    expect(view.rows.map((row) => [row.title, row.time, row.tone, row.badge])).toEqual([
      ['Passada', '08:00–08:30', 'past', null],
      ['Daily do time', '09:55–10:10', 'now', 'agora'],
      ['1:1', '10:25–10:55', 'upcoming', 'próxima em 25 min'],
    ]);
    expect(view.rows[1]?.detail).toBe('Sala 1 · Fulano');
  });

  it('without a meeting in progress, the headline is the next one', () => {
    expect(toAgendaView(snapshot([past, next]), NOW).headline).toBe('Próxima em 25 min: 1:1');
  });

  it('only offers Join for a future or ongoing meeting, never cancelled or past', () => {
    const view = toAgendaView(snapshot([past, running, next, cancelled]), NOW);
    expect(view.rows.map((row) => [row.title, row.joinUrl !== null])).toEqual([
      ['Passada', false],
      ['Daily do time', true],
      ['1:1', true],
      ['Planejamento', false],
    ]);
    expect(view.rows[3]?.tone).toBe('cancelled');
  });

  it('all-day goes to its own list as "All day"', () => {
    const day = dayBounds(NOW, ZONE);
    const holiday = meeting('Feriado', day.startsAt, day.endsAt + 1000, { allDay: true });
    const view = toAgendaView(snapshot([holiday]), NOW);
    expect(view.allDay.map((row) => [row.title, row.time, row.badge])).toEqual([['Feriado', 'Dia todo', null]]);
    expect(view.rows).toEqual([]);
    expect(view.headline).toBeNull();
    expect(view.isEmpty).toBe(false);
  });

  it('a day without meetings is empty', () => {
    const view = toAgendaView(snapshot([]), NOW);
    expect(view).toEqual({ headline: null, allDay: [], rows: [], isEmpty: true });
  });
});

describe('isStale', () => {
  const day = dayBounds(NOW, ZONE);

  it('the day is valid until the last second and expires on the next one', () => {
    expect(isStale(snapshot([]), day.endsAt)).toBe(false);
    expect(isStale(snapshot([]), day.endsAt + 1_000)).toBe(true);
  });

  it('at 23:59:59.5 it is still the same day and at midnight it expires', () => {
    const lastInstant = Date.parse('2026-11-06T02:59:59.500Z');
    const midnight = Date.parse('2026-11-06T03:00:00.000Z');
    expect(day.startsAt).toBe(Date.parse('2026-11-05T03:00:00.000Z'));
    expect(isStale(snapshot([]), lastInstant)).toBe(false);
    expect(isStale(snapshot([]), midnight)).toBe(true);
    expect(isStale(snapshot([]), midnight - 1)).toBe(false);
  });

  it("after a whole night the previous day's snapshot expires", () => {
    expect(isStale(snapshot([]), Date.parse('2026-11-07T15:00:00Z'))).toBe(true);
  });
});
