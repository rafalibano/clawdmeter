import type { PageModule } from '../../../application/pages';
import type { LoadSessions, SessionsData } from '../../../application/use-cases';
import { SessionsComponent } from './sessions.component';
import { SESSIONS_PAGE } from './sessions-page-ref';

export const SESSIONS_POLL_INTERVAL_MS = 5_000;

export function createSessionsPage(deps: { loadSessions: LoadSessions }): PageModule<SessionsData> {
  return {
    id: SESSIONS_PAGE.id,
    title: 'Sessions',
    requiredConnections: [],
    pollIntervalMs: SESSIONS_POLL_INTERVAL_MS,
    load: () => deps.loadSessions.execute(),
    component: SessionsComponent,
  };
}
