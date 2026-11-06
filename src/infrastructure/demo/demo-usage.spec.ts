import { describe, expect, it } from 'vitest';
import { createConnections } from '../../application/connections/create-connections';
import { FakeClock } from '../../application/testing/fake-clock';
import { FAKE_ACCOUNT, createFakeConnectionWorld } from '../../application/testing/fake-connection-adapters';
import { LoadSessions, LoadUsage } from '../../application/use-cases';
import { DEFAULT_ATTENTION_CONFIG } from '../../domain/sessions';
import { DAY_MS, MINUTE_MS } from '../../domain/time';
import { TOTAL_RETENTION_MS } from '../../domain/usage';
import { DemoProcessProbe, DemoSessionDirectory } from './demo-sessions';
import { DemoUsageGateway, DemoUsageHistoryStores, DemoUsageModel, DemoUsageModels } from './demo-usage';
import { DemoUsageIndicator } from './demo-usage-indicator';

const ORIGIN = new Date(2026, 10, 5, 14, 30).getTime();

describe('demo usage model', () => {
  const model = new DemoUsageModel(ORIGIN);

  it('history has a gap between 4d and 2.5d ago to exercise the line break', () => {
    const points = model.history(ORIGIN).sevenDay;
    expect(points.some((point) => point.at > ORIGIN - 4 * DAY_MS + MINUTE_MS && point.at < ORIGIN - 2.5 * DAY_MS - MINUTE_MS)).toBe(false);
    expect(points.some((point) => point.at < ORIGIN - 7 * DAY_MS)).toBe(true);
  });

  it('history covers ~30 days, in order and never beyond 30 days', () => {
    const history = model.history(ORIGIN);
    for (const points of [history.fiveHour, history.sevenDay]) {
      expect(points.length).toBeGreaterThan(5_000);
      expect(points[0]!.at).toBeGreaterThanOrEqual(ORIGIN - TOTAL_RETENTION_MS - 15 * MINUTE_MS);
      expect(points.map((point) => point.at)).toEqual([...points.map((point) => point.at)].sort((a, b) => a - b));
      expect(points.every((point) => point.utilization >= 0 && point.utilization <= 100)).toBe(true);
    }
  });

  it('the 5h window resets several times and the weekly one also drops at the reset', () => {
    const history = model.history(ORIGIN);
    const drops = (points: typeof history.fiveHour) =>
      points.filter((point, index) => index > 0 && point.utilization < points[index - 1]!.utilization - 1).length;
    expect(drops(history.fiveHour)).toBeGreaterThan(20);
    expect(drops(history.sevenDay)).toBeGreaterThanOrEqual(3);
  });

  it('the current window is active, with a future reset and growing usage', () => {
    const early = model.snapshotAt(ORIGIN);
    const later = model.snapshotAt(ORIGIN + 30 * MINUTE_MS);
    expect(early.fiveHour!.resetsAt).toBeGreaterThan(ORIGIN);
    expect(early.fiveHour!.utilization).toBeGreaterThan(5);
    expect(later.fiveHour!.utilization).toBeGreaterThanOrEqual(early.fiveHour!.utilization);
    expect(early.sevenDay!.resetsAt).toBeGreaterThan(ORIGIN + DAY_MS);
  });

  it('high scenario: 7d above 90% and 5h around 60%', () => {
    const snapshot = new DemoUsageModel(ORIGIN, true).snapshotAt(ORIGIN);
    expect(snapshot.sevenDay!.utilization).toBeGreaterThan(90);
    expect(snapshot.sevenDay!.utilization).toBeLessThan(100);
    expect(snapshot.fiveHour!.utilization).toBeGreaterThan(50);
    expect(snapshot.fiveHour!.utilization).toBeLessThan(70);
  });

  it('is deterministic', () => {
    expect(model.snapshotAt(ORIGIN - 2 * DAY_MS)).toEqual(new DemoUsageModel(ORIGIN).snapshotAt(ORIGIN - 2 * DAY_MS));
  });

  it('the demo gateway mirrors what Rust does: an account that must sign in again fails with claude-signin-required', async () => {
    const expired = new Set(['demo-personal']);
    const gateway = new DemoUsageGateway(new DemoUsageModels(ORIGIN, 'demo-personal'), () => ORIGIN, {
      requiresSignIn: (accountId) => expired.has(accountId),
    });
    await expect(gateway.fetch('demo-personal')).rejects.toMatchObject({ problem: 'claude-signin-required' });
    expired.clear();
    expect((await gateway.fetch('demo-personal')).fiveHour).not.toBeNull();
  });

  it('each demo account has its own deterministic usage and history', async () => {
    const models = new DemoUsageModels(ORIGIN, 'demo-personal');
    const gateway = new DemoUsageGateway(models, () => ORIGIN);
    const personal = await gateway.fetch('demo-personal');
    const work = await gateway.fetch('demo-work');
    expect(personal).toEqual(model.snapshotAt(ORIGIN));
    expect(work.fiveHour?.utilization).not.toBe(personal.fiveHour?.utilization);
    const stores = new DemoUsageHistoryStores(models);
    expect((await stores.forAccount('demo-work').load()).fiveHour.length).toBeGreaterThan(5_000);
    expect(stores.forAccount('demo-work')).toBe(stores.forAccount('demo-work'));
    expect(await stores.adoptLegacy()).toBe(false);
  });

  it('LoadUsage with the demo already returns a ready forecast for the 5h window', async () => {
    const world = createFakeConnectionWorld();
    const clock = new FakeClock();
    await clock.advance(ORIGIN);
    const connections = createConnections(world.adapters, world.settings);
    const models = new DemoUsageModels(ORIGIN, FAKE_ACCOUNT.id);
    const load = new LoadUsage(
      world.prefs,
      world.settings,
      new DemoUsageGateway(models, () => clock.now()),
      new DemoUsageHistoryStores(models),
      clock,
      connections,
      new DemoUsageIndicator(),
    );
    const data = await load.execute();
    expect(data.history.fiveHour.length).toBeGreaterThan(5_000);
  });
});

describe('demo sessions', () => {
  it('shows sessions in several states, hides the dead one and ignores the corrupt file', async () => {
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
