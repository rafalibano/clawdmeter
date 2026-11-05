import type { PageModule } from '../../../application/pages';
import { LoadAgenda, type AgendaSnapshot, type ConnectionProblemReporter } from '../../../application/use-cases/calendar';
import type { CalendarGateway, Clock } from '../../../application/ports';
import { isMaintenancePage } from '../../../domain/settings';
import { underMaintenance } from '../../../application/pages';
import { MaintenanceComponent } from '../maintenance/maintenance.component';
import { TeamsComponent } from './teams.component';
import { TEAMS_PAGE } from './teams-page-ref';

const AGENDA_POLL_MS = 10 * 60_000;

export function createTeamsPage(deps: {
  clock: Clock;
  calendar: CalendarGateway;
  reporter: ConnectionProblemReporter;
}): PageModule<AgendaSnapshot> {
  const loadAgenda = new LoadAgenda(deps.calendar, deps.clock, deps.reporter);
  const page: PageModule<AgendaSnapshot> = {
    id: TEAMS_PAGE.id,
    title: 'Agenda',
    requiredConnections: ['microsoft'],
    pollIntervalMs: AGENDA_POLL_MS,
    load: () => loadAgenda.execute(),
    component: TeamsComponent,
  };
  return isMaintenancePage(page.id) ? underMaintenance(page, MaintenanceComponent) : page;
}
