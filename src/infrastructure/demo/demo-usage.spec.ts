import { describe, expect, it } from 'vitest';
import { createConnections } from '../../application/connections/create-connections';
import { FakeClock } from '../../application/testing/fake-clock';
import { createFakeConnectionWorld } from '../../application/testing/fake-connection-adapters';
import { LoadSessions, LoadUsage } from '../../application/use-cases';
import { DEFAULT_ATTENTION_CONFIG } from '../../domain/sessions';
import { DAY_MS, MINUTE_MS } from '../../domain/time';
import { TOTAL_RETENTION_MS } from '../../domain/usage';
import { DemoProcessProbe, DemoSessionDirectory } from './demo-sessions';
import { DemoUsageGateway, DemoUsageHistoryStore, DemoUsageModel } from './demo-usage';

const ORIGIN = new Date(2026, 10, 5, 14, 30).getTime();

describe('modelo de usage do demo', () => {
  const model = new DemoUsageModel(ORIGIN);

  it('histórico cobre ~30 dias, em ordem e sem passar de 30 dias', () => {
    const history = model.history(ORIGIN);
    for (const points of [history.fiveHour, history.sevenDay]) {
      expect(points.length).toBeGreaterThan(5_000);
      expect(points[0]!.at).toBeGreaterThanOrEqual(ORIGIN - TOTAL_RETENTION_MS - 15 * MINUTE_MS);
      expect(points.map((point) => point.at)).toEqual([...points.map((point) => point.at)].sort((a, b) => a - b));
      expect(points.every((point) => point.utilization >= 0 && point.utilization <= 100)).toBe(true);
    }
  });

  it('janela de 5h reseta várias vezes e o semanal também cai no reset', () => {
    const history = model.history(ORIGIN);
    const drops = (points: typeof history.fiveHour) =>
      points.filter((point, index) => index > 0 && point.utilization < points[index - 1]!.utilization - 1).length;
    expect(drops(history.fiveHour)).toBeGreaterThan(20);
    expect(drops(history.sevenDay)).toBeGreaterThanOrEqual(3);
  });

  it('a janela atual está ativa, com reset no futuro e uso crescente', () => {
    const early = model.snapshotAt(ORIGIN);
    const later = model.snapshotAt(ORIGIN + 30 * MINUTE_MS);
    expect(early.fiveHour!.resetsAt).toBeGreaterThan(ORIGIN);
    expect(early.fiveHour!.utilization).toBeGreaterThan(5);
    expect(later.fiveHour!.utilization).toBeGreaterThanOrEqual(early.fiveHour!.utilization);
    expect(early.sevenDay!.resetsAt).toBeGreaterThan(ORIGIN + DAY_MS);
  });

  it('é determinístico', () => {
    expect(model.snapshotAt(ORIGIN - 2 * DAY_MS)).toEqual(new DemoUsageModel(ORIGIN).snapshotAt(ORIGIN - 2 * DAY_MS));
  });

  it('LoadUsage com o demo já devolve previsão pronta para a janela de 5h', async () => {
    const world = createFakeConnectionWorld();
    const clock = new FakeClock();
    await clock.advance(ORIGIN);
    const connections = createConnections(world.adapters, clock);
    const load = new LoadUsage(
      world.prefs,
      world.claude,
      new DemoUsageGateway(model, () => clock.now()),
      new DemoUsageHistoryStore(model.history(ORIGIN)),
      clock,
      connections,
    );
    const data = await load.execute();
    expect(data.forecasts.fiveHour.status).toBe('ready');
    expect(data.history.fiveHour.length).toBeGreaterThan(5_000);
  });
});

describe('sessões do demo', () => {
  it('mostra sessões em vários estados, esconde a morta e ignora o arquivo corrompido', async () => {
    const clock = new FakeClock();
    await clock.advance(ORIGIN);
    const data = await new LoadSessions(
      new DemoSessionDirectory(ORIGIN),
      new DemoProcessProbe(),
      clock,
      DEFAULT_ATTENTION_CONFIG,
    ).execute();
    expect(data.sessions.map((session) => session.status).sort()).toEqual(['busy', 'busy', 'idle', 'idle', 'shell']);
    expect(data.sessions.some((session) => session.name === 'old-experiment')).toBe(false);
    expect(data.sessions[0]?.pid).toBeDefined();
  });
});
