import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectionProblemError, actionsFor } from '../../../domain/connections';
import { DAY_MS, MINUTE_MS } from '../../../domain/time';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID } from '../../../domain/settings';
import { createEmptyHistory, type UsageSnapshot } from '../../../domain/usage';
import { createConnections, type Connections } from '../../connections/create-connections';
import { FakeClock, flushPromises } from '../../testing/fake-clock';
import { createFakeConnectionWorld, type FakeConnectionWorld } from '../../testing/fake-connection-adapters';
import { FAKE_ACCOUNT, settingsWithAccounts } from '../../testing/fake-connection-adapters';
import {
  FakeExternalUsageHistorySource,
  FakeUsageGateway,
  FakeUsageHistoryStore,
  FakeUsageHistoryStores,
  FakeUsageIndicator,
} from '../../testing/fake-usage-adapters';
import { ImportExternalUsageHistory } from './import-external-usage-history';
import { LoadUsage, type UsageData } from './load-usage';
import type { NotifyUsageQuartiles } from './notify-usage-quartiles';

const START = 1_800_000_000_000;

let world: FakeConnectionWorld;
let clock: FakeClock;
let connections: Connections;
let gateway: FakeUsageGateway;
let histories: FakeUsageHistoryStores;
let history: FakeUsageHistoryStore;
let indicator: FakeUsageIndicator;
let loadUsage: LoadUsage;

beforeEach(async () => {
  world = createFakeConnectionWorld();
  clock = new FakeClock();
  await clock.advance(START);
  connections = createConnections(world.adapters, world.settings);
  gateway = new FakeUsageGateway();
  histories = new FakeUsageHistoryStores();
  history = histories.forAccount(FAKE_ACCOUNT.id);
  indicator = new FakeUsageIndicator();
  loadUsage = new LoadUsage(world.prefs, world.settings, gateway, histories, clock, connections, indicator);
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

  it('reads the active account with the client id from the settings and tags the data with it', async () => {
    const data = await loadUsage.execute();
    expect(gateway.requests).toEqual([{ accountId: FAKE_ACCOUNT.id, clientId: DEFAULT_CLAUDE_OAUTH_CLIENT_ID }]);
    expect(data.accountId).toBe(FAKE_ACCOUNT.id);
  });

  it('each account records into its own history', async () => {
    const work = { id: 'account-2', name: 'Work' };
    await loadUsage.execute();
    world.settings.emitExternalChange(settingsWithAccounts([FAKE_ACCOUNT, work], work.id));
    await clock.advance(MINUTE_MS);
    const data = await loadUsage.execute();
    expect(data.accountId).toBe(work.id);
    expect(histories.forAccount(work.id).current.fiveHour).toHaveLength(1);
    expect(history.current.fiveHour).toHaveLength(1);
    expect(gateway.requests.map((request) => request.accountId)).toEqual([FAKE_ACCOUNT.id, work.id]);
  });

  it('without an active account: "add an account" on the Claude connection, without calling Rust', async () => {
    world.settings.emitExternalChange(settingsWithAccounts([]));
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-no-account' });
    expect(gateway.fetches).toBe(0);
    const status = connections.monitor.get('claude');
    expect(status).toMatchObject({ state: 'error', problem: 'claude-no-account' });
    expect(actionsFor('claude', status).find((action) => action.kind === 'fix')).toMatchObject({ label: 'add-claude-account' });
    expect(history.saved).toHaveLength(0);
  });

  it('claude_signin_required becomes "sign in again" for the active account, without recording history', async () => {
    gateway.outcome = new ConnectionProblemError('claude-signin-required', 'refresh rejected');
    const error = await loadUsage.execute().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ problem: 'claude-signin-required', code: 'claude-signin-required', args: { account: 'Personal' } });
    expect((error as Error).message).toBe('claude-signin-required');
    const status = connections.monitor.get('claude');
    expect(status).toEqual({ state: 'error', problem: 'claude-signin-required', code: 'claude-signin-required', args: { account: 'Personal' } });
    expect(actionsFor('claude', status).find((action) => action.kind === 'fix')).toMatchObject({ label: 'reauthenticate-claude' });
    expect(history.saved).toHaveLength(0);
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

  it('after a sign-in error, the first success rechecks the connection and clears the error', async () => {
    gateway.outcome = new ConnectionProblemError('claude-signin-required');
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

  it('a network error, a sign-in error and a disconnected Claude send null to the indicator', async () => {
    gateway.outcome = new Error('Anthropic respondeu 500');
    await expect(loadUsage.execute()).rejects.toThrow('500');
    gateway.outcome = new ConnectionProblemError('claude-signin-required');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-signin-required' });
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

describe('LoadUsage when the active account changes during the fetch', () => {
  const work = { id: 'account-2', name: 'Work' };

  async function switchDuringFetch(): Promise<Promise<unknown>> {
    world.settings.emitExternalChange(settingsWithAccounts([FAKE_ACCOUNT, work], FAKE_ACCOUNT.id));
    const release = gateway.hold();
    const loading = loadUsage.execute().catch((error: unknown) => error);
    await flushPromises();
    world.settings.emitExternalChange(settingsWithAccounts([FAKE_ACCOUNT, work], work.id));
    release();
    return loading;
  }

  it('records the reading in the history of the account it belongs to but leaves the tray and the connection alone', async () => {
    gateway.outcome = new ConnectionProblemError('claude-signin-required');
    await expect(loadUsage.execute()).rejects.toMatchObject({ problem: 'claude-signin-required' });
    gateway.outcome = { fiveHour: { utilization: 33, resetsAt: null }, sevenDay: null };
    indicator.updates.length = 0;
    const data = (await switchDuringFetch()) as UsageData;
    expect(data.accountId).toBe(FAKE_ACCOUNT.id);
    expect(history.current.fiveHour.map((point) => point.utilization)).toEqual([33]);
    expect(histories.forAccount(work.id).saved).toEqual([]);
    expect(indicator.updates).toEqual([]);
    expect(connections.monitor.get('claude')).toMatchObject({ state: 'error', problem: 'claude-signin-required' });
  });

  it('a failure of the previous account neither blanks the tray nor marks the connection of the new one', async () => {
    gateway.outcome = new ConnectionProblemError('claude-signin-required', 'refresh rejected');
    const error = await switchDuringFetch();
    expect(error).toMatchObject({ problem: 'claude-signin-required', args: { account: 'Personal' } });
    expect(indicator.updates).toEqual([]);
    expect(connections.monitor.get('claude').state).toBe('unknown');
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
      world.settings,
      gateway,
      histories,
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

  it('hands the account and the snapshot to the quartile alerts without waiting for them', async () => {
    const received: Array<[string, UsageSnapshot]> = [];
    const alerts = {
      execute: (accountId: string, snapshot: UsageSnapshot) => {
        received.push([accountId, snapshot]);
        return new Promise<void>(() => undefined);
      },
    } as unknown as NotifyUsageQuartiles;
    const withAlerts = new LoadUsage(world.prefs, world.settings, gateway, histories, clock, connections, indicator, undefined, alerts);
    const data = await withAlerts.execute();
    expect(received).toEqual([[FAKE_ACCOUNT.id, data.snapshot]]);
  });

  it('keeps working when the alerts reject', async () => {
    const alerts = { execute: () => Promise.reject(new Error('boom')) } as unknown as NotifyUsageQuartiles;
    const withAlerts = new LoadUsage(world.prefs, world.settings, gateway, histories, clock, connections, indicator, undefined, alerts);
    await expect(withAlerts.execute()).resolves.toMatchObject({ snapshot: gateway.outcome });
  });
});
