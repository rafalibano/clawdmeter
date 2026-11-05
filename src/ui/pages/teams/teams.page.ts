import type { PageModule } from '../../../application/pages';
import { LoadAgenda, type AgendaSnapshot, type ConnectionProblemReporter } from '../../../application/use-cases/calendar';
import type { CalendarGateway, Clock } from '../../../application/ports';
import { TeamsComponent } from './teams.component';
import { TEAMS_PAGE } from './teams-page-ref';

const AGENDA_POLL_MS = 10 * 60_000;

export function createTeamsPage(deps: {
  clock: Clock;
  calendar: CalendarGateway;
  reporter: ConnectionProblemReporter;
}): PageModule<AgendaSnapshot> {
  const loadAgenda = new LoadAgenda(deps.calendar, deps.clock, deps.reporter);
  return {
    id: TEAMS_PAGE.id,
    title: 'Agenda',
    requiredConnections: ['microsoft'],
    pollIntervalMs: AGENDA_POLL_MS,
    load: () => loadAgenda.execute(),
    component: TeamsComponent,
  };
}
