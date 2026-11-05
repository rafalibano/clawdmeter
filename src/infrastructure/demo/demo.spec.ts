import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAgenda, dayBounds } from '../../domain/calendar';
import { createConnections } from '../../application/connections/create-connections';
import { FakeClock } from '../../application/testing/fake-clock';
import { CONNECTIONS, type ConnectionId } from '../../domain/connections';
import { DemoCalendar, createDemoConnectionAdapters } from './demo-adapters';
import { createDemoWorld, parseDemoScenario } from './demo-world';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function checkAll(search: string) {
  const world = createDemoWorld(search);
  const connections = createConnections(createDemoConnectionAdapters(world), new FakeClock());
  const pending = connections.checkMany.execute(CONNECTIONS.map((connection) => connection.id));
  await vi.runAllTimersAsync();
  await pending;
  return connections;
}

async function settle<T>(work: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return work;
}

describe('cenário demo', () => {
  it('lê o query param, ignora ids desconhecidos e expande "errors"', () => {
    expect([...parseDemoScenario('?demo=claude:claude-expired,foo:bar,github')]).toEqual([['claude', 'claude-expired']]);
    expect(parseDemoScenario('?demo=errors').size).toBe(4);
    expect(parseDemoScenario('').size).toBe(0);
  });

  it('sem parâmetro: Claude e notificações ok, GitHub e Microsoft desconectados', async () => {
    const { monitor } = await checkAll('');
    expect(monitor.get('claude').state).toBe('connected');
    expect(monitor.get('notifications').state).toBe('connected');
    expect(monitor.get('github').state).toBe('disconnected');
    expect(monitor.get('microsoft').state).toBe('disconnected');
  });

  it.each([
    ['claude:keychain-denied', 'claude', 'keychain-denied'],
    ['claude:claude-expired', 'claude', 'claude-expired'],
    ['claude:claude-code-missing', 'claude', 'claude-code-missing'],
    ['github:github-unauthorized', 'github', 'github-unauthorized'],
    ['github:github-missing-scope', 'github', 'github-missing-scope'],
    ['github:github-org-access', 'github', 'github-org-access'],
    ['microsoft:microsoft-expired', 'microsoft', 'microsoft-expired'],
    ['notifications:notifications-blocked', 'notifications', 'notifications-blocked'],
    ['notifications:notifications-unverifiable', 'notifications', 'notifications-unverifiable'],
    ['github:github-not-member', 'github', 'github-not-member'],
    ['github:unexpected', 'github', 'unexpected'],
  ] as const)('?demo=%s mostra o estado %s/%s', async (scenario, id, problem) => {
    const { monitor } = await checkAll(`?demo=${scenario}`);
    expect(monitor.get(id as ConnectionId)).toMatchObject({ state: 'error', problem });
  });

  it('keychain: refazer permissão e reler conecta', async () => {
    const connections = await checkAll('?demo=claude:keychain-denied');
    const after = await settle(connections.fix.execute('claude', 'retry-permission'));
    expect(after.state).toBe('connected');
  });

  it('Claude vencido: login no terminal + verificar de novo conecta', async () => {
    const connections = await checkAll('?demo=claude:claude-expired');
    await settle(connections.fix.execute('claude', 'relogin-claude'));
    expect((await settle(connections.check.execute('claude'))).state).toBe('connected');
  });

  it('Claude Code ausente: instalar + verificar de novo conecta', async () => {
    const connections = await checkAll('?demo=claude:claude-code-missing');
    await settle(connections.fix.execute('claude', 'install-claude-code'));
    expect((await settle(connections.check.execute('claude'))).state).toBe('connected');
  });

  it('GitHub: escopo, org e login se resolvem pelos respectivos botões', async () => {
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

  it('Microsoft vencida: refazer login conecta', async () => {
    const connections = await checkAll('?demo=microsoft:microsoft-expired');
    expect((await settle(connections.fix.execute('microsoft', 'relogin-microsoft'))).state).toBe('connected');
  });

  it('notificações bloqueadas: abrir ajustes e verificar de novo conecta', async () => {
    const connections = await checkAll('?demo=notifications:notifications-blocked');
    await settle(connections.fix.execute('notifications', 'open-system-settings'));
    expect((await settle(connections.check.execute('notifications'))).state).toBe('connected');
  });

  it('GitHub desconectado: device flow e PAT do demo conectam', async () => {
    const viaDevice = await checkAll('');
    const code = await viaDevice.github.startDeviceFlow.execute();
    if (code === null) throw new Error('o demo sempre devolve um código');
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

    it('devolve reuniões genéricas, com uma em andamento, uma próxima, uma cancelada e uma de dia inteiro', async () => {
      const calendar = new DemoCalendar(createDemoWorld(''), clock);
      const pending = calendar.meetings(range, 'America/Sao_Paulo');
      await vi.runAllTimersAsync();
      const meetings = await pending;
      expect(meetings.map((meeting) => meeting.title)).toEqual([
        'Alinhamento rápido',
        'Daily do time',
        '1:1',
        'Planejamento',
        'Retrospectiva',
        'Dia de foco',
      ]);
      const agenda = buildAgenda(meetings, NOON);
      expect(agenda.current.map((meeting) => meeting.title)).toEqual(['Daily do time']);
      expect(agenda.next?.meeting.title).toBe('1:1');
      expect(agenda.allDay).toHaveLength(1);
      expect(agenda.timed.filter((item) => item.phase === 'cancelled')).toHaveLength(1);
    });

    it('?demo=microsoft:microsoft-expired faz a agenda falhar com microsoft-expired até refazer o login', async () => {
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

    it('?demo=microsoft:unexpected falha uma vez com erro comum e depois funciona', async () => {
      const calendar = new DemoCalendar(createDemoWorld('?demo=microsoft:unexpected'), clock);
      const first = calendar.meetings(range, 'America/Sao_Paulo');
      const assertion = expect(first).rejects.toThrow('Sem rede');
      await vi.runAllTimersAsync();
      await assertion;
      const second = calendar.meetings(range, 'America/Sao_Paulo');
      await vi.runAllTimersAsync();
      expect(await second).toHaveLength(6);
    });
  });
});
