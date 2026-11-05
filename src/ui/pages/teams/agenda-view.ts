import type { AgendaSnapshot } from '../../../application/use-cases/calendar';
import { buildAgenda, formatClock, formatCountdown, type AgendaItem, type Meeting, type NextMeeting } from '../../../domain/calendar';

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

function headlineOf(current: readonly Meeting[], next: NextMeeting | null): string | null {
  if (current[0]) {
    const extra = current.length > 1 ? ` (+${current.length - 1})` : '';
    return `Agora: ${current[0].title}${extra}`;
  }
  if (next) return `Próxima ${formatCountdown(next.minutesUntil)}: ${next.meeting.title}`;
  return null;
}

function detailOf(item: AgendaItem): string | null {
  const parts = [item.meeting.location, item.meeting.organizer].filter((part): part is string => part !== null && part !== '');
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function toAgendaView(snapshot: AgendaSnapshot, now: number): AgendaView {
  const agenda = buildAgenda(snapshot.meetings, now);
  const zone = snapshot.timeZone;
  const nextId = agenda.next?.meeting.id ?? null;

  const toRow = (item: AgendaItem): MeetingRowView => {
    const { meeting } = item;
    const joinable = !meeting.cancelled && item.phase !== 'past' && meeting.joinUrl !== null;
    let badge: string | null = null;
    if (item.phase === 'now') badge = 'agora';
    else if (meeting.id === nextId && agenda.next) badge = `próxima ${formatCountdown(agenda.next.minutesUntil)}`;
    return {
      id: meeting.id,
      time: meeting.allDay ? 'Dia todo' : `${formatClock(meeting.startsAt, zone)}–${formatClock(meeting.endsAt, zone)}`,
      title: meeting.title,
      detail: detailOf(item),
      tone: item.phase,
      badge,
      joinUrl: joinable ? meeting.joinUrl : null,
    };
  };

  return {
    headline: headlineOf(agenda.current, agenda.next),
    allDay: agenda.allDay.map(toRow),
    rows: agenda.timed.map(toRow),
    isEmpty: snapshot.meetings.length === 0,
  };
}

export function isStale(snapshot: AgendaSnapshot, now: number): boolean {
  return now > snapshot.day.endsAt;
}
