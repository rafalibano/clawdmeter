import { describe, expect, it } from 'vitest';
import { FakeMicrosoft } from '../../application/testing/fake-connection-adapters';
import { ConnectionProblemError } from '../../domain/connections';
import { AUTH_CONFIG } from '../config/auth-config';
import { createFakeFetch, type Responder } from '../testing/fakes';
import { GraphCalendarGateway } from './graph-calendar-gateway';

const RANGE = { startsAt: Date.parse('2026-11-05T03:00:00Z'), endsAt: Date.parse('2026-11-06T02:59:59Z') };
const ZONE = 'America/Sao_Paulo';
const JOIN = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    subject: 'Team daily',
    start: { dateTime: '2026-11-05T09:30:00.0000000', timeZone: ZONE },
    end: { dateTime: '2026-11-05T09:45:00.0000000', timeZone: ZONE },
    isAllDay: false,
    isCancelled: false,
    showAs: 'busy',
    isOnlineMeeting: true,
    onlineMeeting: { joinUrl: JOIN },
    location: { displayName: 'Sala 1' },
    organizer: { emailAddress: { name: 'John', address: 'john@example.com' } },
    ...overrides,
  };
}

function setup(responder: Responder) {
  const { fetcher, requests } = createFakeFetch(responder);
  const authorizer = new FakeMicrosoft();
  return { gateway: new GraphCalendarGateway({ fetcher, authorizer }), requests, authorizer };
}

describe('GraphCalendarGateway', () => {
  it('calls the day\'s calendarView with a time zone Prefer, $select, $orderby and a delegated Bearer', async () => {
    const { gateway, requests } = setup(() => ({ json: { value: [event()] } }));
    const meetings = await gateway.meetings(RANGE, ZONE);

    const url = new URL(requests[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://graph.microsoft.com/v1.0/me/calendarView');
    expect(url.searchParams.get('startDateTime')).toBe('2026-11-05T03:00:00Z');
    expect(url.searchParams.get('endDateTime')).toBe('2026-11-06T02:59:59Z');
    expect(url.searchParams.get('$orderby')).toBe('start/dateTime');
    expect(url.searchParams.get('$top')).toBe('50');
    expect(url.searchParams.get('$select')?.split(',')).toEqual(
      expect.arrayContaining(['subject', 'start', 'end', 'isOnlineMeeting', 'onlineMeeting', 'location', 'isCancelled', 'showAs', 'organizer']),
    );
    expect(requests[0]?.headers).toMatchObject({
      Authorization: 'Bearer graph-token',
      Prefer: 'outlook.timezone="America/Sao_Paulo"',
    });

    expect(meetings).toEqual([
      {
        id: 'e1',
        title: 'Team daily',
        startsAt: Date.parse('2026-11-05T12:30:00Z'),
        endsAt: Date.parse('2026-11-05T12:45:00Z'),
        allDay: false,
        cancelled: false,
        showAs: 'busy',
        organizer: 'John',
        location: 'Sala 1',
        joinUrl: JOIN,
      },
    ]);
  });

  it('follows @odata.nextLink to the end, resending token and Prefer', async () => {
    const next = 'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=abc';
    const { gateway, requests } = setup((request) =>
      request.url === next
        ? { json: { value: [event({ id: 'e2' })] } }
        : { json: { value: [event({ id: 'e1' })], '@odata.nextLink': next } },
    );
    const meetings = await gateway.meetings(RANGE, ZONE);
    expect(meetings.map((meeting) => meeting.id)).toEqual(['e1', 'e2']);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers).toMatchObject({ Authorization: 'Bearer graph-token', Prefer: expect.stringContaining('outlook.timezone') });
  });

  it('never sends the token to a nextLink outside Graph', async () => {
    const { gateway, requests } = setup(() => ({
      json: { value: [event()], '@odata.nextLink': 'https://evil.example.com/steal' },
    }));
    expect(await gateway.meetings(RANGE, ZONE)).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('stops at the page limit if Graph never ends', async () => {
    const { gateway, requests } = setup(() => ({
      json: { value: [event()], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=loop' },
    }));
    await gateway.meetings(RANGE, ZONE);
    expect(requests).toHaveLength(10);
  });

  it('maps cancelled, all-day (always in the calendar time zone) and invalid link', async () => {
    const { gateway } = setup(() => ({
      json: {
        value: [
          event({ id: 'c', isCancelled: true, showAs: 'free' }),
          event({
            id: 'd',
            subject: 'Feriado',
            isAllDay: true,
            start: { dateTime: '2026-11-05T00:00:00.0000000', timeZone: 'UTC' },
            end: { dateTime: '2026-11-06T00:00:00.0000000', timeZone: 'UTC' },
            onlineMeeting: null,
          }),
          event({ id: 'x', onlineMeeting: { joinUrl: 'https://evil.example.com/join' } }),
          event({ id: 'n', subject: null, location: null, organizer: null }),
        ],
      },
    }));
    const [cancelled, allDay, evil, untitled] = await gateway.meetings(RANGE, ZONE);
    expect(cancelled).toMatchObject({ cancelled: true, showAs: 'free' });
    expect(allDay).toMatchObject({
      allDay: true,
      startsAt: Date.parse('2026-11-05T03:00:00Z'),
      endsAt: Date.parse('2026-11-06T03:00:00Z'),
      joinUrl: null,
    });
    expect(evil?.joinUrl).toBeNull();
    expect(untitled).toMatchObject({ title: '', location: null, organizer: null });
  });

  it('respects the time zone reported by Graph and ignores events without a date', async () => {
    const { gateway } = setup(() => ({
      json: {
        value: [
          event({ start: { dateTime: '2026-11-05T12:30:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-05T13:00:00.0000000', timeZone: 'UTC' } }),
          event({ id: 'no-date', start: {} }),
        ],
      },
    }));
    const meetings = await gateway.meetings(RANGE, ZONE);
    expect(meetings).toHaveLength(1);
    expect(meetings[0]?.startsAt).toBe(Date.parse('2026-11-05T12:30:00Z'));
  });

  it('401 becomes microsoft-expired (Sign in to Microsoft again)', async () => {
    const { gateway } = setup(() => ({ status: 401, json: { error: { code: 'InvalidAuthenticationToken' } } }));
    await expect(gateway.meetings(RANGE, ZONE)).rejects.toMatchObject({ problem: 'microsoft-expired' });
  });

  it('403 becomes microsoft-expired with a permission code', async () => {
    const { gateway } = setup(() => ({ status: 403, json: {} }));
    await expect(gateway.meetings(RANGE, ZONE)).rejects.toMatchObject({
      problem: 'microsoft-expired',
      code: 'microsoft-calendar-denied',
    });
  });

  it('an expired token in the authorizer propagates the problem without calling Graph', async () => {
    const { gateway, requests, authorizer } = setup(() => ({ json: { value: [] } }));
    authorizer.tokenOutcome = new ConnectionProblemError('microsoft-expired');
    await expect(gateway.meetings(RANGE, ZONE)).rejects.toMatchObject({ problem: 'microsoft-expired' });
    expect(requests).toEqual([]);
  });

  it('a server error becomes a plain error', async () => {
    const { gateway } = setup(() => ({ status: 503, json: {} }));
    await expect(gateway.meetings(RANGE, ZONE)).rejects.toThrow('503');
  });

  it('sign-in asks only for Calendars.Read and offline_access (delegated, no secret)', () => {
    expect(AUTH_CONFIG.microsoft.scopes).toEqual(expect.arrayContaining(['Calendars.Read', 'offline_access']));
    expect(Object.keys(AUTH_CONFIG.microsoft)).not.toContain('clientSecret');
  });
});
