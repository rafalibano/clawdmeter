import { describe, expect, it } from 'vitest';
import { createConnections } from '../../../application/connections/create-connections';
import { PageRegistry, type PageModule } from '../../../application/pages';
import type { CalendarGateway } from '../../../application/ports';
import { PollingScheduler, type PageUpdate } from '../../../application/scheduler';
import { FakeClock, flushPromises } from '../../../application/testing/fake-clock';
import { createFakeConnectionWorld } from '../../../application/testing/fake-connection-adapters';
import { LoadAgenda, type AgendaSnapshot } from '../../../application/use-cases/calendar';
import { createDefaultSettings } from '../../../domain/settings';
import { ConnectionProblemError, type ConnectionProblem } from '../../../domain/connections';
import { RETRY_ACTION, toFailureView as toFailureViewWith } from './teams-failure-view';

const TEXTS = { errorText: (error: { error: string; problem?: string }) => (error.error === error.problem ? `text:${error.problem}` : error.error) };
const toFailureView = (update: Parameters<typeof toFailureViewWith>[0]) => toFailureViewWith(update, TEXTS);
import { TEAMS_PAGE } from './teams-page-ref';

const NOW = Date.parse('2026-11-05T15:00:00Z');

class FakeCalendar implements CalendarGateway {
  outcome: Error | null = null;

  async meetings(): Promise<[]> {
    if (this.outcome) throw this.outcome;
    return [];
  }
}

function boot() {
  const world = createFakeConnectionWorld();
  const clock = new FakeClock();
  const connections = createConnections(world.adapters, world.settings);
  const calendar = new FakeCalendar();
  const reporter = { execute: connections.report.execute.bind(connections.report) };
  const loadAgenda = new LoadAgenda(calendar, { now: () => NOW, every: () => () => undefined }, reporter);
  const page: PageModule<AgendaSnapshot> = {
    id: TEAMS_PAGE.id,
    title: 'Agenda',
    requiredConnections: ['microsoft'],
    pollIntervalMs: null,
    load: () => loadAgenda.execute(),
    component: class {},
  };
  const scheduler = new PollingScheduler(new PageRegistry([page]), clock);
  return { world, connections, calendar, scheduler };
}

function lateSubscriber(scheduler: PollingScheduler): () => PageUpdate | undefined {
  let latest: PageUpdate | undefined;
  scheduler.subscribe((update) => {
    if (update.pageId === TEAMS_PAGE.id) latest = update;
  });
  return () => latest;
}

describe('toFailureView', () => {
  it('without an error there is no warning', () => {
    expect(toFailureView(undefined)).toBeNull();
    expect(toFailureView({ pageId: 'teams', status: 'ok', data: {} as AgendaSnapshot, at: 0 })).toBeNull();
  });

  it('a regular error falls back to "Try again"', () => {
    const view = toFailureView({ pageId: 'teams', status: 'error', error: 'No network', at: 0 });
    expect(view).toEqual({ message: 'No network', actions: [RETRY_ACTION] });
  });

  it.each<[ConnectionProblem, string, string]>([
    ['microsoft-expired', 'text:microsoft-expired', 'relogin-microsoft'],
    ['microsoft-not-connected', 'text:microsoft-not-connected', 'connect'],
  ])('problem %s shows readable text and the right button, without depending on the connection row', (problem, message, label) => {
    const view = toFailureView({ pageId: 'teams', status: 'error', error: message, problem, at: 0 });
    expect(view?.message).toBe(message);
    expect(view?.actions.map((action) => action.label)).toContain(label);
    expect(view?.actions.map((action) => action.kind)).not.toContain('disconnect');
  });
});

describe('Agenda: 401 at boot with the page opened later', () => {
  it('shows the readable text and "Sign in to Microsoft again", and the fix reloads the agenda', async () => {
    const { world, connections, calendar, scheduler } = boot();
    calendar.outcome = new ConnectionProblemError('microsoft-expired');
    scheduler.sync({ ...createDefaultSettings(), enabledPages: { teams: true } });
    await flushPromises();

    const latest = lateSubscriber(scheduler);
    const view = toFailureView(latest());
    expect(view?.message).toBe('text:microsoft-expired');
    expect(view?.message).not.toBe('microsoft-expired');
    const fix = view?.actions.find((action) => action.kind === 'fix');
    expect(fix?.label).toBe('relogin-microsoft');

    calendar.outcome = null;
    if (fix?.kind === 'fix') await connections.fix.execute('microsoft', fix.fix);
    await scheduler.refresh(TEAMS_PAGE.id);
    expect(world.microsoft.signedIn).toBe(1);
    expect(latest()).toMatchObject({ status: 'ok' });
    expect(toFailureView(latest())).toBeNull();
  });

  it('never connected: the button is "Connect" and connecting reloads the agenda', async () => {
    const { world, connections, calendar, scheduler } = boot();
    calendar.outcome = new ConnectionProblemError('microsoft-not-connected');
    scheduler.sync({ ...createDefaultSettings(), enabledPages: { teams: true } });
    await flushPromises();

    const latest = lateSubscriber(scheduler);
    const view = toFailureView(latest());
    expect(view?.message).toBe('text:microsoft-not-connected');
    expect(view?.actions.map((action) => action.label)).toEqual(['connect']);
    expect(connections.monitor.get('microsoft')).toEqual({ state: 'disconnected' });

    calendar.outcome = null;
    await connections.connect.execute('microsoft');
    await scheduler.refresh(TEAMS_PAGE.id);
    expect(world.microsoft.signedIn).toBe(1);
    expect(toFailureView(latest())).toBeNull();
  });
});
