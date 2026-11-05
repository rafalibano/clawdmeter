import type { Localizer } from '../../i18n';
import type { AgendaSnapshot } from '../../../application/use-cases/calendar';
import { buildAgenda, dayBounds, formatClock, type AgendaItem, type Meeting, type NextMeeting } from '../../../domain/calendar';

export type RowTone = 'now' | 'upcoming' | 'past' | 'cancelled';

export interface MeetingRowView {
  id: string;
  time: string;
  title: string;
  detail: string | null;
  tone: RowTone;
  badge: string | null;
  joinUrl: string | null;
}

export interface AgendaView {
  headline: string | null;
  allDay: MeetingRowView[];
  rows: MeetingRowView[];
  isEmpty: boolean;
}

function titleOf(meeting: Meeting, l: Localizer): string {
  return meeting.title === '' ? l.t('teams.untitled') : meeting.title;
}

function headlineOf(current: readonly Meeting[], next: NextMeeting | null, l: Localizer): string | null {
  if (current[0]) {
    return current.length > 1
      ? l.t('teams.nowMore', { title: titleOf(current[0], l), extra: current.length - 1 })
      : l.t('teams.now', { title: titleOf(current[0], l) });
  }
  if (next) return l.t('teams.next', { when: l.countdown(next.minutesUntil), title: titleOf(next.meeting, l) });
  return null;
}

function detailOf(item: AgendaItem): string | null {
  const parts = [item.meeting.location, item.meeting.organizer].filter((part): part is string => part !== null && part !== '');
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function toAgendaView(snapshot: AgendaSnapshot, now: number, l: Localizer): AgendaView {
  const agenda = buildAgenda(snapshot.meetings, now);
  const zone = snapshot.timeZone;
  const nextId = agenda.next?.meeting.id ?? null;

  const toRow = (item: AgendaItem): MeetingRowView => {
    const { meeting } = item;
    const joinable = !meeting.cancelled && item.phase !== 'past' && meeting.joinUrl !== null;
    let badge: string | null = null;
    if (item.phase === 'now') badge = l.t('teams.badge.now');
    else if (meeting.id === nextId && agenda.next) badge = l.t('teams.badge.next', { when: l.countdown(agenda.next.minutesUntil) });
    return {
      id: meeting.id,
      time: meeting.allDay ? l.t('teams.allDay') : `${formatClock(meeting.startsAt, zone)}–${formatClock(meeting.endsAt, zone)}`,
      title: titleOf(meeting, l),
      detail: detailOf(item),
      tone: item.phase,
      badge,
      joinUrl: joinable ? meeting.joinUrl : null,
    };
  };

  return {
    headline: headlineOf(agenda.current, agenda.next, l),
    allDay: agenda.allDay.map(toRow),
    rows: agenda.timed.map(toRow),
    isEmpty: snapshot.meetings.length === 0,
  };
}

export function isStale(snapshot: AgendaSnapshot, now: number): boolean {
  return dayBounds(now, snapshot.timeZone).startsAt !== snapshot.day.startsAt;
}
