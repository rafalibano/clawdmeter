import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectionProblemError, actionsFor } from '../../../domain/connections';
import { DAY_MS, MINUTE_MS } from '../../../domain/time';
import { createEmptyHistory, type UsageSnapshot } from '../../../domain/usage';
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
import type { NotifyUsageQuartiles } from './notify-usage-quartiles';

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
  it('reads usage through the gateway (no token in TS), records one point per window and starts collecting data', async () => {
    const data = await loadUsage.execute();
    expect(gateway.fetches).toBe(1);
    expect(data.at).toBe(START);
    expect(history.saved).toHaveLength(1);
    expect(history.current.fiveHour).toEqual([{ at: START, utilization: 20, resetsAt: START + 3_600_000 }]);
    expect(history.current.sevenDay).toHaveLength(1);
  });

  it('accumulates history between readings', async () => {
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

  it('applies retention: points older than 30 days leave the stored history', async () => {
    history.current = {
      fiveHour: [{ at: START - 31 * DAY_MS, utilization: 99, resetsAt: null }],
      sevenDay: [],
    };
    await loadUsage.execute();
    expect(history.current.fiveHour.map((point) => point.utilization)).toEqual([20]);
  });

  it('a window missing from the response records no point', async () => {
    gateway.outcome = { fiveHour: { utilization: 5, resetsAt: null }, sevenDay: null };
    const data = await loadUsage.execute();
    expect(data.history.sevenDay).toEqual([]);
  });

  it('401 becomes a Claude connection problem with the "Sign in to Claude again" button', async () => {
    gateway.outcome = new ConnectionProblemError('claude-expired');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-expired' });
    const status = connections.monitor.get('claude');
    expect(status).toMatchObject({ state: 'error', problem: 'claude-expired' });
    const fix = actionsFor('claude', status).find((action) => action.kind === 'fix');
    expect(fix).toMatchObject({ label: 'relogin-claude' });
    expect(history.saved).toHaveLength(0);
  });

  it('an expired token (detected in Rust) becomes a connection problem without recording history', async () => {
    gateway.outcome = new ConnectionProblemError('claude-expired');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-expired' });
    expect(connections.monitor.get('claude')).toMatchObject({ state: 'error', problem: 'claude-expired' });
    expect(history.saved).toHaveLength(0);
  });

  it('a denied keychain and a missing Claude Code reach the connection', async () => {
    gateway.outcome = new ConnectionProblemError('keychain-denied');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'keychain-denied' });
    expect(connections.monitor.get('claude')).toMatchObject({ state: 'error', problem: 'keychain-denied' });
    gateway.outcome = new ConnectionProblemError('claude-code-missing');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-code-missing' });
  });

  it('Claude disconnected in Settings: does not call Rust', async () => {
    await connections.disconnect.execute('claude');
    await expect(loadUsage.execute()).rejects.toThrow('usage-disconnected');
    expect(gateway.fetches).toBe(0);
    expect(connections.monitor.get('claude')).toEqual({ state: 'disconnected' });
  });

  it('a network error does not touch the connection', async () => {
    gateway.outcome = new Error('Anthropic respondeu 500');
    await expect(loadUsage.execute()).rejects.toThrow('500');
    expect(connections.monitor.get('claude').state).toBe('unknown');
  });

  it('after a 401, the first success rechecks the connection and clears the error', async () => {
    gateway.outcome = new ConnectionProblemError('claude-expired');
    await expect(loadUsage.execute()).rejects.toThrow();
    gateway.outcome = { fiveHour: { utilization: 1, resetsAt: null }, sevenDay: null };
    await loadUsage.execute();
    expect(connections.monitor.get('claude').state).toBe('connected');
  });

  it('empty history on first use', async () => {
    expect(await history.load()).toEqual(createEmptyHistory());
  });
});

describe('LoadUsage and the tray indicator', () => {
  it('each successful reading hands the snapshot and the time to the indicator', async () => {
    const data = await loadUsage.execute();
    expect(indicator.updates).toEqual([{ snapshot: data.snapshot, now: START }]);
    await clock.advance(MINUTE_MS);
    await loadUsage.execute();
    expect(indicator.updates.map((update) => update.now)).toEqual([START, START + MINUTE_MS]);
  });

  it('a network error, an expired token and a disconnected Claude send null to the indicator', async () => {
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

  it('updates the indicator even when saving the history fails afterwards', async () => {
    history.save = async () => {
      throw new Error('disk full');
    };
    await expect(loadUsage.execute()).rejects.toThrow('disk full');
    expect(indicator.updates).toHaveLength(1);
    expect(indicator.updates[0]?.snapshot).not.toBeNull();
  });

  it('an indicator failure does not break the usage page', async () => {
    indicator.failure = new Error('tray unavailable');
    const data = await loadUsage.execute();
    expect(data.snapshot).toEqual(gateway.outcome);
    gateway.outcome = new Error('500');
    await expect(loadUsage.execute()).rejects.toThrow('500');
  });
});

describe('LoadUsage with external history (one-time migration)', () => {
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

  it('on the first load merges the external points, without a false cycle, and records the marker', async () => {
    source.outcome = externalPoints();
    const data = await withImport.execute();
    expect(data.history.fiveHour).toHaveLength(7);
    expect(history.current.fiveHour.filter((point) => point.imported)).toHaveLength(6);
    expect(data.history.fiveHour.at(-1)).toEqual({ at: START, utilization: 20, resetsAt: START + 3_600_000 });
    expect(history.imported).toBe(START);
  });

  it('after importing never reads the file again', async () => {
    source.outcome = [{ at: START - 20 * MINUTE_MS, fiveHour: 10, sevenDay: 5 }];
    await withImport.execute();
    await clock.advance(MINUTE_MS);
    source.outcome = [{ at: START - 10 * MINUTE_MS, fiveHour: 11, sevenDay: 6 }];
    const data = await withImport.execute();
    expect(source.reads).toBe(1);
    expect(data.history.fiveHour).toHaveLength(3);
    expect(history.imported).toBe(START);
  });

  it('whoever already has an imported point is marked without reading the source', async () => {
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

  it('an existing marker prevents reading, even without imported points in the history', async () => {
    history.imported = START - DAY_MS;
    source.outcome = externalPoints();
    const data = await withImport.execute();
    expect(source.reads).toBe(0);
    expect(history.imported).toBe(START - DAY_MS);
    expect(data.history.fiveHour).toHaveLength(1);
  });

  it('a missing file (empty source) also completes the migration', async () => {
    await withImport.execute();
    await withImport.execute();
    expect(source.reads).toBe(1);
    expect(history.imported).toBe(START);
  });

  it('a failing source is silently ignored and retried on the next load', async () => {
    source.outcome = new Error('unreadable file');
    const data = await withImport.execute();
    expect(data.history.fiveHour).toHaveLength(1);
    expect(history.imported).toBeNull();
    source.outcome = externalPoints();
    await withImport.execute();
    expect(source.reads).toBe(2);
    expect(history.imported).toBe(START);
  });

  it('the point read now wins over the external one right next to it', async () => {
    source.outcome = [{ at: START - 30_000, fiveHour: 99, sevenDay: 99 }];
    const data = await withImport.execute();
    expect(data.history.fiveHour).toEqual([{ at: START, utilization: 20, resetsAt: START + 3_600_000 }]);
  });

  it('retention applies to imported points: older than 30 days is left out', async () => {
    source.outcome = [{ at: START - 31 * DAY_MS, fiveHour: 50, sevenDay: 50 }];
    const data = await withImport.execute();
    expect(data.history.fiveHour).toHaveLength(1);
  });

  it('hands the snapshot to the quartile alerts without waiting for them', async () => {
    const received: UsageSnapshot[] = [];
    const alerts = {
      execute: (snapshot: UsageSnapshot) => {
        received.push(snapshot);
        return new Promise<void>(() => undefined);
      },
    } as unknown as NotifyUsageQuartiles;
    const withAlerts = new LoadUsage(world.prefs, gateway, history, clock, connections, indicator, undefined, alerts);
    const data = await withAlerts.execute();
    expect(received).toEqual([data.snapshot]);
  });

  it('keeps working when the alerts reject', async () => {
    const alerts = { execute: () => Promise.reject(new Error('boom')) } as unknown as NotifyUsageQuartiles;
    const withAlerts = new LoadUsage(world.prefs, gateway, history, clock, connections, indicator, undefined, alerts);
    await expect(withAlerts.execute()).resolves.toMatchObject({ snapshot: gateway.outcome });
  });
});
