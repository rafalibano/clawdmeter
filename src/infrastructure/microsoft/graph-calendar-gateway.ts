import type { CalendarGateway, MicrosoftAuthorizer } from '../../application/ports';
import {
  isValidTimeZone,
  parseShowAs,
  parseWallClock,
  teamsJoinUrl,
  type DayBounds,
  type Meeting,
} from '../../domain/calendar';
import { ConnectionProblemError } from '../../domain/connections';
import type { FetchLike } from '../platform/tauri-fetch';

const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const CALENDAR_VIEW_URL = `${GRAPH_ORIGIN}/v1.0/me/calendarView`;
const SELECT_FIELDS = [
  'subject',
  'start',
  'end',
  'isAllDay',
  'isOnlineMeeting',
  'onlineMeeting',
  'location',
  'isCancelled',
  'showAs',
  'organizer',
].join(',');
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

interface GraphDateTime {
  dateTime?: string;
  timeZone?: string;
}

interface GraphEvent {
  id?: string;
  subject?: string | null;
  start?: GraphDateTime;
  end?: GraphDateTime;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  onlineMeeting?: { joinUrl?: string | null } | null;
  location?: { displayName?: string | null } | null;
  organizer?: { emailAddress?: { name?: string | null } | null } | null;
}

interface GraphPage {
  value?: GraphEvent[];
  '@odata.nextLink'?: string;
}

export interface GraphCalendarGatewayDeps {
  fetcher: FetchLike;
  authorizer: MicrosoftAuthorizer;
}

function isoSeconds(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function firstUrl(range: DayBounds): string {
  const query = [
    `startDateTime=${encodeURIComponent(isoSeconds(range.startsAt))}`,
    `endDateTime=${encodeURIComponent(isoSeconds(range.endsAt))}`,
    `$select=${encodeURIComponent(SELECT_FIELDS)}`,
    `$orderby=${encodeURIComponent('start/dateTime')}`,
    `$top=${PAGE_SIZE}`,
  ];
  return `${CALENDAR_VIEW_URL}?${query.join('&')}`;
}

function isGraphUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.origin === GRAPH_ORIGIN;
  } catch {
    return false;
  }
}

export class GraphCalendarGateway implements CalendarGateway {
  constructor(private readonly deps: GraphCalendarGatewayDeps) {}

  async meetings(range: DayBounds, timeZone: string): Promise<Meeting[]> {
    const token = await this.deps.authorizer.accessToken();
    const meetings: Meeting[] = [];
    let url: string | undefined = firstUrl(range);
    for (let page = 0; url !== undefined && page < MAX_PAGES; page += 1) {
      const body = await this.fetchPage(url, token, timeZone);
      for (const event of body.value ?? []) {
        const meeting = toMeeting(event, timeZone);
        if (meeting) meetings.push(meeting);
      }
      const next = body['@odata.nextLink'];
      url = next !== undefined && isGraphUrl(next) ? next : undefined;
    }
    return meetings;
  }

  private async fetchPage(url: string, token: string, timeZone: string): Promise<GraphPage> {
    const response = await this.deps.fetcher(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        Prefer: `outlook.timezone="${timeZone}"`,
      },
    });
    if (response.status === 401) throw new ConnectionProblemError('microsoft-expired');
    if (response.status === 403) {
      throw new ConnectionProblemError('microsoft-expired', undefined, 'microsoft-calendar-denied');
    }
    if (!response.ok) throw new Error(`Microsoft Graph responded ${response.status}`);
    return (await response.json()) as GraphPage;
  }
}

function toMeeting(event: GraphEvent, timeZone: string): Meeting | null {
  const allDay = event.isAllDay === true;
  const startsAt = toEpoch(event.start, allDay, timeZone);
  const endsAt = toEpoch(event.end, allDay, timeZone);
  if (event.id === undefined || startsAt === null || endsAt === null) return null;
  return {
    id: event.id,
    title: event.subject?.trim() ?? '',
    startsAt,
    endsAt,
    allDay,
    cancelled: event.isCancelled === true,
    showAs: parseShowAs(event.showAs),
    organizer: event.organizer?.emailAddress?.name?.trim() || null,
    location: event.location?.displayName?.trim() || null,
    joinUrl: teamsJoinUrl(event.onlineMeeting?.joinUrl),
  };
}

function toEpoch(value: GraphDateTime | undefined, allDay: boolean, requestedZone: string): number | null {
  if (value?.dateTime === undefined) return null;
  const reported = value.timeZone;
  const zone = !allDay && reported !== undefined && isValidTimeZone(reported) ? reported : requestedZone;
  return parseWallClock(value.dateTime, zone);
}
