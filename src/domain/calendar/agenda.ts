import type { Meeting } from './meeting';
import type { DayBounds } from './time-zone';

export type MeetingPhase = 'past' | 'now' | 'upcoming' | 'cancelled';

export interface AgendaItem {
  meeting: Meeting;
  phase: MeetingPhase;
}

export interface NextMeeting {
  meeting: Meeting;
  minutesUntil: number;
}

export interface Agenda {
  allDay: AgendaItem[];
  timed: AgendaItem[];
  current: Meeting[];
  next: NextMeeting | null;
}

const MINUTE_MS = 60_000;

export function meetingsOfDay(meetings: readonly Meeting[], day: DayBounds): Meeting[] {
  return meetings.filter((meeting) => {
    const startsInDay = meeting.startsAt >= day.startsAt && meeting.startsAt <= day.endsAt;
    return startsInDay || (meeting.startsAt < day.startsAt && meeting.endsAt > day.startsAt);
  });
}

function byStart(a: Meeting, b: Meeting): number {
  return a.startsAt - b.startsAt || a.endsAt - b.endsAt || a.title.localeCompare(b.title);
}

function phaseOf(meeting: Meeting, now: number): MeetingPhase {
  if (meeting.cancelled) return 'cancelled';
  if (meeting.endsAt <= now) return 'past';
  if (meeting.startsAt <= now) return 'now';
  return 'upcoming';
}

export function buildAgenda(meetings: readonly Meeting[], now: number): Agenda {
  const sorted = [...meetings].sort(byStart);
  const allDay = sorted.filter((meeting) => meeting.allDay).map((meeting) => asItem(meeting, now));
  const timed = sorted.filter((meeting) => !meeting.allDay).map((meeting) => asItem(meeting, now));
  const current = timed.filter((item) => item.phase === 'now').map((item) => item.meeting);
  const upcoming = timed.find((item) => item.phase === 'upcoming')?.meeting;
  const next = upcoming ? { meeting: upcoming, minutesUntil: Math.ceil((upcoming.startsAt - now) / MINUTE_MS) } : null;
  return { allDay, timed, current, next };
}

function asItem(meeting: Meeting, now: number): AgendaItem {
  if (meeting.allDay) return { meeting, phase: meeting.cancelled ? 'cancelled' : 'upcoming' };
  return { meeting, phase: phaseOf(meeting, now) };
}
