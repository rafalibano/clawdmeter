import { CALENDAR_TIME_ZONE, dayBounds, meetingsOfDay, type DayBounds, type Meeting } from '../../../domain/calendar';
import { ConnectionProblemError, type ConnectionId, type ConnectionProblem } from '../../../domain/connections';
import type { CalendarGateway, Clock } from '../../ports';

export interface AgendaSnapshot {
  meetings: Meeting[];
  day: DayBounds;
  timeZone: string;
}

export interface ConnectionProblemReporter {
  execute(id: ConnectionId, problem: ConnectionProblem, message?: string): void;
}

export class LoadAgenda {
  constructor(
    private readonly calendar: CalendarGateway,
    private readonly clock: Clock,
    private readonly reporter: ConnectionProblemReporter,
    private readonly timeZone: string = CALENDAR_TIME_ZONE,
  ) {}

  async execute(): Promise<AgendaSnapshot> {
    const day = dayBounds(this.clock.now(), this.timeZone);
    try {
      const meetings = await this.calendar.meetings(day, this.timeZone);
      return { meetings: meetingsOfDay(meetings, day), day, timeZone: this.timeZone };
    } catch (error) {
      if (error instanceof ConnectionProblemError) {
        this.reporter.execute('microsoft', error.problem, error.message === error.problem ? undefined : error.message);
      }
      throw error;
    }
  }
}
