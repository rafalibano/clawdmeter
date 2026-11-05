import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectionProblemError, actionsFor } from '../../../domain/connections';
import { DAY_MS, MINUTE_MS } from '../../../domain/time';
import { createEmptyHistory } from '../../../domain/usage';
import { createConnections, type Connections } from '../../connections/create-connections';
import { FakeClock } from '../../testing/fake-clock';
import { createFakeConnectionWorld, type FakeConnectionWorld } from '../../testing/fake-connection-adapters';
import { FakeUsageGateway, FakeUsageHistoryStore } from '../../testing/fake-usage-adapters';
import { LoadUsage } from './load-usage';

const START = 1_800_000_000_000;

let world: FakeConnectionWorld;
let clock: FakeClock;
let connections: Connections;
let gateway: FakeUsageGateway;
let history: FakeUsageHistoryStore;
let loadUsage: LoadUsage;

beforeEach(async () => {
  world = createFakeConnectionWorld();
  clock = new FakeClock();
  await clock.advance(START);
  connections = createConnections(world.adapters, clock);
  gateway = new FakeUsageGateway();
  history = new FakeUsageHistoryStore();
  loadUsage = new LoadUsage(world.prefs, world.claude, gateway, history, clock, connections);
});

describe('LoadUsage', () => {
  it('usa o access token do Claude Code, grava um ponto por janela e começa coletando dados', async () => {
    world.claude.outcome = { accessToken: 'sk-ant-oat01-x', expiresAt: null, subscriptionType: 'max' };
    const data = await loadUsage.execute();
    expect(gateway.tokens).toEqual(['sk-ant-oat01-x']);
    expect(data.at).toBe(START);
    expect(history.saved).toHaveLength(1);
    expect(history.current.fiveHour).toEqual([{ at: START, utilization: 20, resetsAt: START + 3_600_000 }]);
    expect(history.current.sevenDay).toHaveLength(1);
    expect(data.forecasts.fiveHour).toEqual({ status: 'collecting' });
  });

  it('acumula o histórico entre leituras e passa a prever com 3 pontos', async () => {
    for (let minute = 0; minute < 3; minute++) {
      gateway.outcome = {
        fiveHour: { utilization: 20 + minute * 2, resetsAt: START + 3_600_000 },
        sevenDay: { utilization: 10, resetsAt: START + DAY_MS },
      };
      await loadUsage.execute();
      await clock.advance(MINUTE_MS);
    }
    const data = await loadUsage.execute();
    expect(data.history.fiveHour).toHaveLength(4);
    expect(data.forecasts.fiveHour.status).toBe('ready');
  });

  it('aplica a retenção: pontos com mais de 30 dias saem do histórico gravado', async () => {
    history.current = {
      fiveHour: [{ at: START - 31 * DAY_MS, utilization: 99, resetsAt: null }],
      sevenDay: [],
    };
    await loadUsage.execute();
    expect(history.current.fiveHour.map((point) => point.utilization)).toEqual([20]);
  });

  it('janela ausente na resposta não grava ponto', async () => {
    gateway.outcome = { fiveHour: { utilization: 5, resetsAt: null }, sevenDay: null };
    const data = await loadUsage.execute();
    expect(data.history.sevenDay).toEqual([]);
    expect(data.forecasts.sevenDay.status).toBe('collecting');
  });

  it('401 vira problema de conexão do Claude com o botão "Refazer login do Claude"', async () => {
    gateway.outcome = new ConnectionProblemError('claude-expired');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-expired' });
    const status = connections.monitor.get('claude');
    expect(status).toMatchObject({ state: 'error', problem: 'claude-expired' });
    const fix = actionsFor('claude', status).find((action) => action.kind === 'fix');
    expect(fix).toMatchObject({ label: 'Refazer login do Claude' });
    expect(history.saved).toHaveLength(0);
  });

  it('token vencido: não chama a API e nunca tenta refresh', async () => {
    world.claude.outcome = { accessToken: 't', expiresAt: START - 1, subscriptionType: null };
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-expired' });
    expect(gateway.tokens).toEqual([]);
    expect(connections.monitor.get('claude')).toMatchObject({ state: 'error', problem: 'claude-expired' });
  });

  it('cofre negado e Claude Code ausente chegam à conexão', async () => {
    world.claude.outcome = new ConnectionProblemError('keychain-denied');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'keychain-denied' });
    expect(connections.monitor.get('claude')).toMatchObject({ state: 'error', problem: 'keychain-denied' });
    world.claude.outcome = new ConnectionProblemError('claude-code-missing');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-code-missing' });
  });

  it('Claude desconectado em Ajustes: não lê a credencial', async () => {
    await connections.disconnect.execute('claude');
    await expect(loadUsage.execute()).rejects.toThrow('Claude desconectado');
    expect(world.claude.reads).toBe(0);
    expect(connections.monitor.get('claude')).toEqual({ state: 'disconnected' });
  });

  it('erro de rede não mexe na conexão', async () => {
    gateway.outcome = new Error('Anthropic respondeu 500');
    await expect(loadUsage.execute()).rejects.toThrow('500');
    expect(connections.monitor.get('claude').state).toBe('unknown');
  });

  it('depois de um 401, o primeiro sucesso confere a conexão de novo e limpa o erro', async () => {
    gateway.outcome = new ConnectionProblemError('claude-expired');
    await expect(loadUsage.execute()).rejects.toThrow();
    gateway.outcome = { fiveHour: { utilization: 1, resetsAt: null }, sevenDay: null };
    await loadUsage.execute();
    expect(connections.monitor.get('claude').state).toBe('connected');
  });

  it('histórico vazio no primeiro uso', async () => {
    expect(await history.load()).toEqual(createEmptyHistory());
  });
});
