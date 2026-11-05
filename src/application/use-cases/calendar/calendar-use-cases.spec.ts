import { describe, expect, it } from 'vitest';
import { dayBounds, type Meeting } from '../../../domain/calendar';
import { ConnectionProblemError, type ConnectionId, type ConnectionProblem } from '../../../domain/connections';
import type { CalendarGateway } from '../../ports';
import { FakeUrlOpener } from '../../testing/fake-connection-adapters';
import { JoinMeeting } from './join-meeting';
import { LoadAgenda } from './load-agenda';

const NOW = Date.parse('2026-11-05T15:00:00Z');
const DAY = dayBounds(NOW, 'America/Sao_Paulo');

function meeting(id: string, startsAt: number, endsAt: number): Meeting {
  return { id, title: id, startsAt, endsAt, allDay: false, cancelled: false, showAs: 'busy', organizer: null, location: null, joinUrl: null };
}

class FakeCalendar implements CalendarGateway {
  outcome: Meeting[] | Error = [];
  ranges: Array<{ startsAt: number; endsAt: number; timeZone: string }> = [];

  async meetings(range: { startsAt: number; endsAt: number }, timeZone: string): Promise<Meeting[]> {
    this.ranges.push({ ...range, timeZone });
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

class RecordingReporter {
  reports: Array<{ id: ConnectionId; problem: ConnectionProblem; message?: string }> = [];

  execute(id: ConnectionId, problem: ConnectionProblem, message?: string): void {
    this.reports.push(message === undefined ? { id, problem } : { id, problem, message });
  }
}

function setup() {
  const calendar = new FakeCalendar();
  const reporter = new RecordingReporter();
  const nowClock = { now: () => NOW, every: () => () => undefined };
  return { calendar, reporter, loadAgenda: new LoadAgenda(calendar, nowClock, reporter) };
}

describe('LoadAgenda', () => {
  it('asks for today in America/Sao_Paulo and returns only what belongs to the day', async () => {
    const { calendar, loadAgenda } = setup();
    const inside = meeting('today', DAY.startsAt + 3_600_000, DAY.startsAt + 7_200_000);
    const tomorrow = meeting('tomorrow', DAY.endsAt + 1000, DAY.endsAt + 3_600_000);
    calendar.outcome = [inside, tomorrow];
    const snapshot = await loadAgenda.execute();
    expect(calendar.ranges).toEqual([{ ...DAY, timeZone: 'America/Sao_Paulo' }]);
    expect(snapshot).toEqual({ meetings: [inside], day: DAY, timeZone: 'America/Sao_Paulo' });
  });

  it('a Microsoft connection problem is reported and rethrown', async () => {
    const { calendar, reporter, loadAgenda } = setup();
    calendar.outcome = new ConnectionProblemError('microsoft-expired');
    await expect(loadAgenda.execute()).rejects.toMatchObject({ problem: 'microsoft-expired' });
    expect(reporter.reports).toEqual([{ id: 'microsoft', problem: 'microsoft-expired' }]);
  });

  it('keeps the specific problem message when reporting', async () => {
    const { calendar, reporter, loadAgenda } = setup();
    calendar.outcome = new ConnectionProblemError('microsoft-expired', 'Calendars.Read permission not granted');
    await expect(loadAgenda.execute()).rejects.toThrow('permission');
    expect(reporter.reports[0]).toMatchObject({ message: 'Calendars.Read permission not granted' });
  });

  it('an ordinary error (network) is rethrown without flagging the connection', async () => {
    const { calendar, reporter, loadAgenda } = setup();
    calendar.outcome = new Error('No network');
    await expect(loadAgenda.execute()).rejects.toThrow('No network');
    expect(reporter.reports).toEqual([]);
  });
});

describe('JoinMeeting', () => {
  it('opens the Teams link', async () => {
    const opener = new FakeUrlOpener();
    await new JoinMeeting(opener).execute('https://teams.microsoft.com/l/meetup-join/abc');
    expect(opener.opened).toEqual(['https://teams.microsoft.com/l/meetup-join/abc']);
  });

  it.each([null, 'http://teams.microsoft.com/x', 'https://evil.example.com/x', 'file:///etc/passwd'])(
    'rejects %s without opening anything',
    async (url) => {
      const opener = new FakeUrlOpener();
      await expect(new JoinMeeting(opener).execute(url)).rejects.toThrow('link-invalid-meeting');
      expect(opener.opened).toEqual([]);
    },
  );
});
