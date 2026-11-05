import type { DayBounds, Meeting } from '../../domain/calendar';

export interface CalendarGateway {
  meetings(range: DayBounds, timeZone: string): Promise<Meeting[]>;
}
