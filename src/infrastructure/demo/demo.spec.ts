import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAgenda, dayBounds } from '../../domain/calendar';
import { createClaudeAccounts } from '../../application/claude-accounts';
import { createConnections } from '../../application/connections/create-connections';
import { FakeClock } from '../../application/testing/fake-clock';
import { FakeSettingsStore } from '../../application/testing/fake-settings-store';
import { FakeUsageHistoryStores } from '../../application/testing/fake-usage-adapters';
import { UpdateSettings } from '../../application/use-cases';
import { CONNECTIONS, type ConnectionId } from '../../domain/connections';
import { DemoCalendar, createDemoConnectionAdapters } from './demo-adapters';
import { DEMO_ACCOUNTS, DemoAccountsSettingsStore, DemoClaudeAccountGateway, demoAccountsFor } from './demo-claude-accounts';
import { createDemoWorld, parseDemoScenario, type DemoWorld } from './demo-world';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function demoSettings(world: DemoWorld): DemoAccountsSettingsStore {
  return new DemoAccountsSettingsStore(new FakeSettingsStore(), demoAccountsFor(world));
}

async function checkAll(search: string) {
  const world = createDemoWorld(search);
  const connections = createConnections(createDemoConnectionAdapters(world), demoSettings(world));
  const pending = connections.checkMany.execute(CONNECTIONS.map((connection) => connection.id));
  await vi.runAllTimersAsync();
  await pending;
  return connections;
}

async function settle<T>(work: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return work;
}

describe('demo scenario', () => {
  it('reads the query param, ignores unknown ids and expands "errors"', () => {
    expect([...parseDemoScenario('?demo=claude:claude-signin-required,foo:bar,github')]).toEqual([['claude', 'claude-signin-required']]);
    expect(parseDemoScenario('?demo=errors').size).toBe(4);
    expect(parseDemoScenario('').size).toBe(0);
  });

  it('without a parameter: Claude and notifications ok, GitHub and Microsoft disconnected', async () => {
    const { monitor } = await checkAll('');
    expect(monitor.get('claude').state).toBe('connected');
    expect(monitor.get('notifications').state).toBe('connected');
    expect(monitor.get('github').state).toBe('disconnected');
    expect(monitor.get('microsoft').state).toBe('disconnected');
  });

  it.each([
    ['claude:claude-signin-required', 'claude', 'claude-signin-required'],
    ['claude:claude-no-account', 'claude', 'claude-no-account'],
    ['github:github-unauthorized', 'github', 'github-unauthorized'],
    ['github:github-missing-scope', 'github', 'github-missing-scope'],
    ['github:github-org-access', 'github', 'github-org-access'],
    ['microsoft:microsoft-expired', 'microsoft', 'microsoft-expired'],
    ['notifications:notifications-blocked', 'notifications', 'notifications-blocked'],
    ['notifications:notifications-unverifiable', 'notifications', 'notifications-unverifiable'],
    ['github:github-not-member', 'github', 'github-not-member'],
    ['github:unexpected', 'github', 'unexpected'],
  ] as const)('?demo=%s shows the state %s/%s', async (scenario, id, problem) => {
    const { monitor } = await checkAll(`?demo=${scenario}`);
    expect(monitor.get(id as ConnectionId)).toMatchObject({ state: 'error', problem });
  });

  it('two demo accounts by default, the first one active', async () => {
    const settings = demoSettings(createDemoWorld(''));
    expect((await settings.load()).claude).toMatchObject({ accounts: DEMO_ACCOUNTS, activeAccountId: 'demo-personal' });
  });

  it('?demo=claude:claude-signin-required: signing in again through the demo browser connects', async () => {
    const world = createDemoWorld('?demo=claude:claude-signin-required');
    const gateway = new DemoClaudeAccountGateway(world);
    const settings = demoSettings(world);
    const connections = createConnections(createDemoConnectionAdapters(world, gateway), settings);
    expect(await settle(connections.check.execute('claude'))).toMatchObject({ problem: 'claude-signin-required' });
    const accounts = createClaudeAccounts({
      settings,
      updateSettings: new UpdateSettings(settings),
      gateway,
      urls: { open: async () => undefined },
      histories: new FakeUsageHistoryStores(),
      clock: new FakeClock(),
      newId: () => 'demo-new',
    });
    expect(await settle(accounts.reauthenticate.execute('demo-personal'))).toEqual(DEMO_ACCOUNTS[0]);
    expect(await settle(connections.check.execute('claude'))).toEqual({ state: 'connected', account: 'Personal' });
  });

  it('?demo=claude:claude-no-account: adding an account through the demo browser connects', async () => {
    const world = createDemoWorld('?demo=claude:claude-no-account');
    const gateway = new DemoClaudeAccountGateway(world);
    const settings = demoSettings(world);
    const connections = createConnections(createDemoConnectionAdapters(world, gateway), settings);
    const accounts = createClaudeAccounts({
      settings,
      updateSettings: new UpdateSettings(settings),
      gateway,
      urls: { open: async () => undefined },
      histories: new FakeUsageHistoryStores(),
      clock: new FakeClock(),
      newId: () => 'demo-new',
    });
    expect(await settle(accounts.add.execute('Work'))).toEqual({ id: 'demo-new', name: 'Work' });
    expect(await settle(connections.check.execute('claude'))).toEqual({ state: 'connected', account: 'Work' });
  });

  it('GitHub: scope, org and login are resolved by their respective buttons', async () => {
    const scope = await checkAll('?demo=github:github-missing-scope');
    await settle(scope.fix.execute('github', 'regrant-scopes'));
    expect((await settle(scope.check.execute('github'))).state).toBe('connected');

    const org = await checkAll('?demo=github:github-org-access');
    await settle(org.fix.execute('github', 'authorize-org'));
    expect((await settle(org.check.execute('github'))).state).toBe('connected');

    const login = await checkAll('?demo=github:github-unauthorized');
    await settle(login.fix.execute('github', 'relogin-github'));
    expect((await settle(login.check.execute('github'))).state).toBe('connected');
  });

  it('?demo=github:gh-not-installed shows the missing gh and Install + Connect leads to login', async () => {
    const connections = await checkAll('?demo=github:gh-not-installed');
    expect(connections.monitor.get('github')).toMatchObject({ state: 'disconnected', cli: 'not-installed' });
    await settle(connections.fix.execute('github', 'install-github-cli'));
    expect(await settle(connections.connect.execute('github'))).toMatchObject({ cli: 'not-logged-in' });
    await settle(connections.fix.execute('github', 'connect-github-cli'));
    expect((await settle(connections.connect.execute('github'))).state).toBe('connected');
  });

  it('?demo=github:gh-not-logged-in shows gh without login and Connect GitHub CLI connects', async () => {
    const connections = await checkAll('?demo=github:gh-not-logged-in');
    expect(connections.monitor.get('github')).toMatchObject({ state: 'disconnected', cli: 'not-logged-in' });
    await settle(connections.fix.execute('github', 'connect-github-cli'));
    expect((await settle(connections.connect.execute('github'))).state).toBe('connected');
  });

  it('Microsoft vencida: refazer login conecta', async () => {
    const connections = await checkAll('?demo=microsoft:microsoft-expired');
    expect((await settle(connections.fix.execute('microsoft', 'relogin-microsoft'))).state).toBe('connected');
  });

  it('blocked notifications: opening settings and checking again connects', async () => {
    const connections = await checkAll('?demo=notifications:notifications-blocked');
    await settle(connections.fix.execute('notifications', 'open-system-settings'));
    expect((await settle(connections.check.execute('notifications'))).state).toBe('connected');
  });

  it('disconnected GitHub: the demo device flow and PAT connect', async () => {
    const viaDevice = await checkAll('');
    const code = await viaDevice.github.startDeviceFlow.execute();
    if (code === null) throw new Error('the demo always returns a code');
    expect((await settle(viaDevice.github.completeDeviceFlow.execute(code))).state).toBe('connected');

    const viaPat = await checkAll('');
    expect((await settle(viaPat.github.connectWithPat.execute('ghp_qualquer'))).state).toBe('connected');
    const invalid = await checkAll('');
    expect(await settle(invalid.github.connectWithPat.execute('lixo'))).toMatchObject({ problem: 'github-unauthorized' });
  });

  describe('agenda', () => {
    const NOON = Date.parse('2026-11-05T15:00:00Z');
    const clock = { now: () => NOON, every: () => () => undefined };
    const range = dayBounds(NOON, 'America/Sao_Paulo');

    it('returns generic meetings, with one in progress, one upcoming, one cancelled and one all-day', async () => {
      const calendar = new DemoCalendar(createDemoWorld(''), clock);
      const pending = calendar.meetings(range, 'America/Sao_Paulo');
      await vi.runAllTimersAsync();
      const meetings = await pending;
      expect(meetings.map((meeting) => meeting.title)).toEqual([
        'Quick sync',
        'Team daily',
        '1:1',
        'Planning',
        'Retrospective',
        'Focus day',
      ]);
      const agenda = buildAgenda(meetings, NOON);
      expect(agenda.current.map((meeting) => meeting.title)).toEqual(['Team daily']);
      expect(agenda.next?.meeting.title).toBe('1:1');
      expect(agenda.allDay).toHaveLength(1);
      expect(agenda.timed.filter((item) => item.phase === 'cancelled')).toHaveLength(1);
    });

    it('?demo=microsoft:microsoft-expired makes the agenda fail with microsoft-expired until signing in again', async () => {
      const world = createDemoWorld('?demo=microsoft:microsoft-expired');
      const adapters = createDemoConnectionAdapters(world);
      const calendar = new DemoCalendar(world, clock);
      const failing = calendar.meetings(range, 'America/Sao_Paulo');
      const assertion = expect(failing).rejects.toMatchObject({ problem: 'microsoft-expired' });
      await vi.runAllTimersAsync();
      await assertion;

      const signIn = adapters.microsoft.signIn();
      await vi.runAllTimersAsync();
      await signIn;
      const recovered = calendar.meetings(range, 'America/Sao_Paulo');
      await vi.runAllTimersAsync();
      expect(await recovered).toHaveLength(6);
    });

    it('?demo=microsoft:unexpected fails once with a plain error and then works', async () => {
      const calendar = new DemoCalendar(createDemoWorld('?demo=microsoft:unexpected'), clock);
      const first = calendar.meetings(range, 'America/Sao_Paulo');
      const assertion = expect(first).rejects.toThrow('No network');
      await vi.runAllTimersAsync();
      await assertion;
      const second = calendar.meetings(range, 'America/Sao_Paulo');
      await vi.runAllTimersAsync();
      expect(await second).toHaveLength(6);
    });
  });
});
