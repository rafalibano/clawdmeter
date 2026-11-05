import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectionProblemError, actionsFor } from '../../../domain/connections';
import { DAY_MS, MINUTE_MS } from '../../../domain/time';
import { createEmptyHistory } from '../../../domain/usage';
import { createConnections, type Connections } from '../../connections/create-connections';
import { FakeClock } from '../../testing/fake-clock';
import { createFakeConnectionWorld, type FakeConnectionWorld } from '../../testing/fake-connection-adapters';
import {
  FakeExternalUsageHistorySource,
  FakeUsageGateway,
  FakeUsageHistoryStore,
  FakeUsageIndicator,
} from '../../testing/fake-usage-adapters';
import { ImportExternalUsageHistory } from './import-external-usage-history';
import { LoadUsage } from './load-usage';

const START = 1_800_000_000_000;

let world: FakeConnectionWorld;
let clock: FakeClock;
let connections: Connections;
let gateway: FakeUsageGateway;
let history: FakeUsageHistoryStore;
let indicator: FakeUsageIndicator;
let loadUsage: LoadUsage;

beforeEach(async () => {
  world = createFakeConnectionWorld();
  clock = new FakeClock();
  await clock.advance(START);
  connections = createConnections(world.adapters, clock);
  gateway = new FakeUsageGateway();
  history = new FakeUsageHistoryStore();
  indicator = new FakeUsageIndicator();
  loadUsage = new LoadUsage(world.prefs, gateway, history, clock, connections, indicator);
});

describe('LoadUsage', () => {
  it('lê o usage pelo gateway (sem token no TS), grava um ponto por janela e começa coletando dados', async () => {
    const data = await loadUsage.execute();
    expect(gateway.fetches).toBe(1);
    expect(data.at).toBe(START);
    expect(history.saved).toHaveLength(1);
    expect(history.current.fiveHour).toEqual([{ at: START, utilization: 20, resetsAt: START + 3_600_000 }]);
    expect(history.current.sevenDay).toHaveLength(1);
  });

  it('acumula o histórico entre leituras', async () => {
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
  });

  it('401 vira problema de conexão do Claude com o botão "Refazer login do Claude"', async () => {
    gateway.outcome = new ConnectionProblemError('claude-expired');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-expired' });
    const status = connections.monitor.get('claude');
    expect(status).toMatchObject({ state: 'error', problem: 'claude-expired' });
    const fix = actionsFor('claude', status).find((action) => action.kind === 'fix');
    expect(fix).toMatchObject({ label: 'relogin-claude' });
    expect(history.saved).toHaveLength(0);
  });

  it('token vencido (detectado no Rust) vira problema de conexão sem gravar histórico', async () => {
    gateway.outcome = new ConnectionProblemError('claude-expired');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-expired' });
    expect(connections.monitor.get('claude')).toMatchObject({ state: 'error', problem: 'claude-expired' });
    expect(history.saved).toHaveLength(0);
  });

  it('cofre negado e Claude Code ausente chegam à conexão', async () => {
    gateway.outcome = new ConnectionProblemError('keychain-denied');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'keychain-denied' });
    expect(connections.monitor.get('claude')).toMatchObject({ state: 'error', problem: 'keychain-denied' });
    gateway.outcome = new ConnectionProblemError('claude-code-missing');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-code-missing' });
  });

  it('Claude desconectado em Ajustes: não chama o Rust', async () => {
    await connections.disconnect.execute('claude');
    await expect(loadUsage.execute()).rejects.toThrow('usage-disconnected');
    expect(gateway.fetches).toBe(0);
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

describe('LoadUsage e o indicador da bandeja', () => {
  it('a cada leitura bem-sucedida entrega o snapshot e o horário ao indicador', async () => {
    const data = await loadUsage.execute();
    expect(indicator.updates).toEqual([{ snapshot: data.snapshot, now: START }]);
    await clock.advance(MINUTE_MS);
    await loadUsage.execute();
    expect(indicator.updates.map((update) => update.now)).toEqual([START, START + MINUTE_MS]);
  });

  it('erro de rede, token vencido e Claude desconectado mandam null ao indicador', async () => {
    gateway.outcome = new Error('Anthropic respondeu 500');
    await expect(loadUsage.execute()).rejects.toThrow('500');
    gateway.outcome = new ConnectionProblemError('claude-expired');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-expired' });
    await connections.disconnect.execute('claude');
    await expect(loadUsage.execute()).rejects.toThrow('usage-disconnected');
    expect(indicator.updates).toEqual([
      { snapshot: null, now: START },
      { snapshot: null, now: START },
      { snapshot: null, now: START },
    ]);
  });

  it('atualiza o indicador mesmo quando gravar o histórico falha depois', async () => {
    history.save = async () => {
      throw new Error('disco cheio');
    };
    await expect(loadUsage.execute()).rejects.toThrow('disco cheio');
    expect(indicator.updates).toHaveLength(1);
    expect(indicator.updates[0]?.snapshot).not.toBeNull();
  });

  it('falha do indicador não derruba a página de usage', async () => {
    indicator.failure = new Error('tray indisponível');
    const data = await loadUsage.execute();
    expect(data.snapshot).toEqual(gateway.outcome);
    gateway.outcome = new Error('500');
    await expect(loadUsage.execute()).rejects.toThrow('500');
  });
});

describe('LoadUsage com histórico externo (migração única)', () => {
  let source: FakeExternalUsageHistorySource;
  let withImport: LoadUsage;

  const externalPoints = () =>
    Array.from({ length: 6 }, (_, index) => ({
      at: START - (6 - index) * 10 * MINUTE_MS,
      fiveHour: 10 + index,
      sevenDay: 5,
    }));

  beforeEach(() => {
    source = new FakeExternalUsageHistorySource();
    withImport = new LoadUsage(
      world.prefs,
      gateway,
      history,
      clock,
      connections,
      indicator,
      new ImportExternalUsageHistory(source),
    );
  });

  it('na primeira carga mescla os pontos externos, sem ciclo falso, e grava o marcador', async () => {
    source.outcome = externalPoints();
    const data = await withImport.execute();
    expect(data.history.fiveHour).toHaveLength(7);
    expect(history.current.fiveHour.filter((point) => point.imported)).toHaveLength(6);
    expect(data.history.fiveHour.at(-1)).toEqual({ at: START, utilization: 20, resetsAt: START + 3_600_000 });
    expect(history.imported).toBe(START);
  });

  it('depois de importar nunca mais lê o arquivo', async () => {
    source.outcome = [{ at: START - 20 * MINUTE_MS, fiveHour: 10, sevenDay: 5 }];
    await withImport.execute();
    await clock.advance(MINUTE_MS);
    source.outcome = [{ at: START - 10 * MINUTE_MS, fiveHour: 11, sevenDay: 6 }];
    const data = await withImport.execute();
    expect(source.reads).toBe(1);
    expect(data.history.fiveHour).toHaveLength(3);
    expect(history.imported).toBe(START);
  });

  it('quem já tem ponto importado é marcado sem ler a fonte', async () => {
    history.current = {
      fiveHour: [{ at: START - 3 * DAY_MS, utilization: 10, resetsAt: null, imported: true }],
      sevenDay: [],
    };
    source.outcome = externalPoints();
    const data = await withImport.execute();
    expect(source.reads).toBe(0);
    expect(history.imported).toBe(START);
    expect(data.history.fiveHour).toHaveLength(2);
  });

  it('marcador existente impede a leitura, mesmo sem pontos importados no histórico', async () => {
    history.imported = START - DAY_MS;
    source.outcome = externalPoints();
    const data = await withImport.execute();
    expect(source.reads).toBe(0);
    expect(history.imported).toBe(START - DAY_MS);
    expect(data.history.fiveHour).toHaveLength(1);
  });

  it('arquivo ausente (fonte vazia) também conclui a migração', async () => {
    await withImport.execute();
    await withImport.execute();
    expect(source.reads).toBe(1);
    expect(history.imported).toBe(START);
  });

  it('fonte que falha é ignorada em silêncio e tenta de novo na próxima carga', async () => {
    source.outcome = new Error('arquivo ilegível');
    const data = await withImport.execute();
    expect(data.history.fiveHour).toHaveLength(1);
    expect(history.imported).toBeNull();
    source.outcome = externalPoints();
    await withImport.execute();
    expect(source.reads).toBe(2);
    expect(history.imported).toBe(START);
  });

  it('o ponto lido agora vence o externo colado nele', async () => {
    source.outcome = [{ at: START - 30_000, fiveHour: 99, sevenDay: 99 }];
    const data = await withImport.execute();
    expect(data.history.fiveHour).toEqual([{ at: START, utilization: 20, resetsAt: START + 3_600_000 }]);
  });

  it('a retenção vale para os importados: mais de 30 dias fica de fora', async () => {
    source.outcome = [{ at: START - 31 * DAY_MS, fiveHour: 50, sevenDay: 50 }];
    const data = await withImport.execute();
    expect(data.history.fiveHour).toHaveLength(1);
  });
});
