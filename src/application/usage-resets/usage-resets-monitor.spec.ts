import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectionMonitor } from '../connections/connection-monitor';
import { RateLimitedError } from '../../domain/rate-limit';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID, type AppSettings } from '../../domain/settings';
import { MINUTE_MS } from '../../domain/time';
import type { UsageResets } from '../../domain/usage';
import { LoadUsageResets, type UsageResetsData } from '../use-cases/usage/load-usage-resets';
import { FakeClock, flushPromises } from '../testing/fake-clock';
import { FAKE_ACCOUNT, createFakeConnectionWorld, settingsWithAccounts, type FakeConnectionWorld } from '../testing/fake-connection-adapters';
import { FakeUsageResetsGateway } from '../testing/fake-usage-adapters';
import { USAGE_RESETS_POLL_INTERVAL_MS, UsageResetsMonitor } from './usage-resets-monitor';

const RESETS: UsageResets = {
  atLimit: false,
  exhausted: [],
  exhaustedScoped: [],
  grants: [
    {
      id: 'g1',
      label: null,
      type: 'weekly',
      resetsLeft: 1,
      resetsTotal: 1,
      startsAt: null,
      endsAt: null,
      clears: ['sevenDay'],
      clearsScoped: [],
      paused: false,
      usableNow: true,
    },
  ],
};

const CUSTOM_CLIENT = '11111111-2222-4333-8444-555555555555';

let world: FakeConnectionWorld;
let clock: FakeClock;
let gateway: FakeUsageResetsGateway;
let connections: ConnectionMonitor;
let monitor: UsageResetsMonitor;
let published: (UsageResetsData | null)[];

function settings(resets: boolean, accountId: string | null = FAKE_ACCOUNT.id, clientId: string | null = null): AppSettings {
  const base = settingsWithAccounts([FAKE_ACCOUNT, { id: 'account-2', name: 'Work' }], accountId);
  const claude = clientId === null ? base.claude : { ...base.claude, useDefaultClientId: false, clientId };
  return { ...base, claude, usageBlocks: { ...base.usageBlocks, resets } };
}

async function use(next: AppSettings, usagePageEnabled = true): Promise<void> {
  monitor.sync(next, usagePageEnabled);
  await flushPromises();
}

function build(loader: LoadUsageResets | null): UsageResetsMonitor {
  const created = new UsageResetsMonitor(loader, clock, connections);
  created.subscribe((data) => published.push(data));
  return created;
}

beforeEach(async () => {
  world = createFakeConnectionWorld();
  clock = new FakeClock();
  await clock.advance(1_800_000_000_000);
  gateway = new FakeUsageResetsGateway();
  gateway.outcome = RESETS;
  connections = new ConnectionMonitor();
  published = [];
  monitor = build(new LoadUsageResets(world.prefs, gateway, clock));
});

describe('UsageResetsMonitor', () => {
  it('polls slower than the usage page: several minutes', () => {
    expect(USAGE_RESETS_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(10 * MINUTE_MS);
  });

  it('with the block on it reads once right away and publishes the data', async () => {
    await use(settings(true));
    expect(gateway.fetches).toBe(1);
    expect(monitor.current).toMatchObject({ accountId: FAKE_ACCOUNT.id, resets: RESETS });
  });

  it('with the block off it never reads and never starts a timer', async () => {
    await use(settings(false));
    await clock.advance(10 * USAGE_RESETS_POLL_INTERVAL_MS);
    expect(gateway.fetches).toBe(0);
    expect(clock.activeTimers()).toBe(0);
    expect(monitor.current).toBeNull();
  });

  it('with the Usage page turned off it never reads, even with the block on, and reads once the page is back', async () => {
    await use(settings(true), false);
    await clock.advance(5 * USAGE_RESETS_POLL_INTERVAL_MS);
    expect(gateway.fetches).toBe(0);
    expect(clock.activeTimers()).toBe(0);
    await use(settings(true), true);
    expect(gateway.fetches).toBe(1);
    await use(settings(true), false);
    expect(monitor.current).toBeNull();
    expect(clock.activeTimers()).toBe(0);
    await clock.advance(3 * USAGE_RESETS_POLL_INTERVAL_MS);
    expect(gateway.fetches).toBe(1);
  });

  it('reads again at each interval, not more often', async () => {
    await use(settings(true));
    await clock.advance(USAGE_RESETS_POLL_INTERVAL_MS - 1);
    expect(gateway.fetches).toBe(1);
    await clock.advance(1);
    expect(gateway.fetches).toBe(2);
    await clock.advance(USAGE_RESETS_POLL_INTERVAL_MS);
    expect(gateway.fetches).toBe(3);
  });

  it('syncing again with unrelated changes does not read again', async () => {
    await use(settings(true));
    monitor.sync(settings(true), true);
    await flushPromises();
    expect(gateway.fetches).toBe(1);
    expect(clock.activeTimers()).toBe(1);
  });

  it('turning the block on reads what the app has in memory, even while the file on disk still says off', async () => {
    world.settings.emitExternalChange(settings(false));
    await use(settings(true));
    expect(gateway.fetches).toBe(1);
    expect(monitor.current).not.toBeNull();
  });

  it('turning the block off clears the data, stops the timer and stops the requests', async () => {
    await use(settings(true));
    await use(settings(false));
    expect(monitor.current).toBeNull();
    expect(clock.activeTimers()).toBe(0);
    await clock.advance(3 * USAGE_RESETS_POLL_INTERVAL_MS);
    expect(gateway.fetches).toBe(1);
  });

  it('turning it back on reads again immediately', async () => {
    await use(settings(true));
    await use(settings(false));
    await use(settings(true));
    expect(gateway.fetches).toBe(2);
    expect(monitor.current).not.toBeNull();
  });

  it('switching the active account drops the old data and reads for the new account', async () => {
    await use(settings(true));
    await use(settings(true, 'account-2'));
    expect(gateway.requests.map((request) => request.accountId)).toEqual([FAKE_ACCOUNT.id, 'account-2']);
    expect(monitor.current?.accountId).toBe('account-2');
    expect(clock.activeTimers()).toBe(1);
  });

  it('changing the client id reads again with the new one', async () => {
    await use(settings(true));
    await use(settings(true, FAKE_ACCOUNT.id, CUSTOM_CLIENT));
    expect(gateway.requests.map((request) => request.clientId)).toEqual([DEFAULT_CLAUDE_OAUTH_CLIENT_ID, CUSTOM_CLIENT]);
    expect(clock.activeTimers()).toBe(1);
  });

  it('an account without resets publishes nothing', async () => {
    gateway.outcome = null;
    await use(settings(true));
    expect(monitor.current).toBeNull();
  });

  it('a failure hides the block, makes no noise and the next interval tries again', async () => {
    await use(settings(true));
    gateway.outcome = new Error('network down');
    await clock.advance(USAGE_RESETS_POLL_INTERVAL_MS);
    expect(monitor.current).toBeNull();
    gateway.outcome = RESETS;
    await clock.advance(USAGE_RESETS_POLL_INTERVAL_MS);
    expect(monitor.current).not.toBeNull();
  });

  it('after a rate limit it waits out the backoff, even if the interval comes first', async () => {
    gateway.outcome = new RateLimitedError(40 * MINUTE_MS);
    await use(settings(true));
    expect(monitor.current).toBeNull();
    gateway.outcome = RESETS;
    await clock.advance(USAGE_RESETS_POLL_INTERVAL_MS);
    await clock.advance(USAGE_RESETS_POLL_INTERVAL_MS);
    expect(gateway.fetches).toBe(1);
    await clock.advance(USAGE_RESETS_POLL_INTERVAL_MS);
    expect(gateway.fetches).toBe(2);
    expect(monitor.current).not.toBeNull();
  });

  it('the backoff of an account survives turning the block off and on', async () => {
    gateway.outcome = new RateLimitedError(40 * MINUTE_MS);
    await use(settings(true));
    gateway.outcome = RESETS;
    await use(settings(false));
    await use(settings(true));
    expect(gateway.fetches).toBe(1);
    await clock.advance(20 * MINUTE_MS);
    await use(settings(false));
    await use(settings(true));
    expect(gateway.fetches).toBe(1);
    await clock.advance(21 * MINUTE_MS);
    await use(settings(false));
    await use(settings(true));
    expect(gateway.fetches).toBe(2);
  });

  it('the backoff survives turning the Usage page off and on, and a client id change', async () => {
    gateway.outcome = new RateLimitedError(40 * MINUTE_MS);
    await use(settings(true));
    gateway.outcome = RESETS;
    await use(settings(true), false);
    await use(settings(true), true);
    await use(settings(true, FAKE_ACCOUNT.id, CUSTOM_CLIENT));
    expect(gateway.fetches).toBe(1);
  });

  it('the backoff of an account survives visiting another account and coming back', async () => {
    gateway.outcome = new RateLimitedError(40 * MINUTE_MS);
    await use(settings(true));
    gateway.outcome = RESETS;
    await use(settings(true, 'account-2'));
    await use(settings(true));
    expect(gateway.requests.map((request) => request.accountId)).toEqual([FAKE_ACCOUNT.id, 'account-2']);
    await clock.advance(41 * MINUTE_MS);
    await use(settings(false));
    await use(settings(true));
    expect(gateway.requests.map((request) => request.accountId)).toEqual([FAKE_ACCOUNT.id, 'account-2', FAKE_ACCOUNT.id]);
  });

  it('a rate limit that arrives after switching account still counts for the account that was read', async () => {
    let fail!: () => void;
    const held = new Promise<void>((_, reject) => {
      fail = () => reject(new RateLimitedError(40 * MINUTE_MS));
    });
    const calls: string[] = [];
    monitor = build(
      new LoadUsageResets(
        world.prefs,
        {
          fetch: async (accountId) => {
            calls.push(accountId);
            if (accountId === FAKE_ACCOUNT.id) await held;
            return RESETS;
          },
        },
        clock,
      ),
    );
    await use(settings(true));
    await use(settings(true, 'account-2'));
    fail();
    await flushPromises();
    expect(monitor.current?.accountId).toBe('account-2');
    await use(settings(true));
    expect(calls).toEqual([FAKE_ACCOUNT.id, 'account-2']);
  });

  it('another account is not held back by the backoff of the first one', async () => {
    gateway.outcome = new RateLimitedError(40 * MINUTE_MS);
    await use(settings(true));
    gateway.outcome = RESETS;
    await use(settings(true, 'account-2'));
    expect(gateway.requests.map((request) => request.accountId)).toEqual([FAKE_ACCOUNT.id, 'account-2']);
    expect(monitor.current?.accountId).toBe('account-2');
  });

  it('a result that arrives after the block was turned off is discarded', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    monitor = build(
      new LoadUsageResets(
        world.prefs,
        {
          fetch: async () => {
            await held;
            return RESETS;
          },
        },
        clock,
      ),
    );
    await use(settings(true));
    await use(settings(false));
    release();
    await flushPromises();
    expect(monitor.current).toBeNull();
  });

  it('a read that is still running is not started twice', async () => {
    let calls = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    monitor = build(
      new LoadUsageResets(
        world.prefs,
        {
          fetch: async () => {
            calls += 1;
            await held;
            return RESETS;
          },
        },
        clock,
      ),
    );
    await use(settings(true));
    await clock.advance(2 * USAGE_RESETS_POLL_INTERVAL_MS);
    expect(calls).toBe(1);
    release();
    await flushPromises();
  });

  it('without a loader it never reads', async () => {
    const idle = build(null);
    idle.sync(settings(true), true);
    await flushPromises();
    expect(idle.current).toBeNull();
    expect(clock.activeTimers()).toBe(0);
  });

  it('stop cancels the timer and clears the data; listeners hear the clear', async () => {
    await use(settings(true));
    monitor.stop();
    expect(clock.activeTimers()).toBe(0);
    expect(monitor.current).toBeNull();
    expect(published.at(-1)).toBeNull();
  });

  it('a new subscriber gets the current value and can unsubscribe', async () => {
    await use(settings(true));
    const heard: (UsageResetsData | null)[] = [];
    const stop = monitor.subscribe((data) => heard.push(data));
    expect(heard).toHaveLength(1);
    expect(heard[0]).not.toBeNull();
    stop();
    monitor.stop();
    expect(heard).toHaveLength(1);
  });
});

describe('UsageResetsMonitor and the Claude connection', () => {
  it('turning the Claude connection back on reads right away instead of waiting for the next interval', async () => {
    connections.set('claude', { state: 'disconnected' });
    world.prefs.current = { ...world.prefs.current, claude: { ...world.prefs.current.claude, enabled: false } };
    await use(settings(true));
    await clock.advance(USAGE_RESETS_POLL_INTERVAL_MS);
    expect(gateway.fetches).toBe(0);
    world.prefs.current = { ...world.prefs.current, claude: { ...world.prefs.current.claude, enabled: true } };
    connections.set('claude', { state: 'checking' });
    await flushPromises();
    expect(gateway.fetches).toBe(0);
    connections.set('claude', { state: 'connected' });
    await flushPromises();
    expect(gateway.fetches).toBe(1);
    expect(monitor.current).not.toBeNull();
  });

  it('coming back from a sign-in error (error, checking, connected) reads once, on connected', async () => {
    await use(settings(true));
    connections.set('claude', { state: 'error', problem: 'claude-signin-required' });
    expect(monitor.current).toBeNull();
    connections.set('claude', { state: 'checking' });
    await flushPromises();
    expect(gateway.fetches).toBe(1);
    connections.set('claude', { state: 'connected' });
    await flushPromises();
    expect(gateway.fetches).toBe(2);
    expect(monitor.current).not.toBeNull();
  });

  it('a connection error hides the block at once', async () => {
    await use(settings(true));
    connections.set('claude', { state: 'error', problem: 'claude-signin-required' });
    expect(monitor.current).toBeNull();
  });

  it('a connected check that follows another connected state with data on screen does not read again', async () => {
    await use(settings(true));
    connections.set('claude', { state: 'connected' });
    connections.set('claude', { state: 'checking' });
    connections.set('claude', { state: 'connected' });
    await flushPromises();
    expect(gateway.fetches).toBe(1);
  });

  it('a read still running when Claude disconnects publishes nothing when it ends', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    monitor = build(
      new LoadUsageResets(
        world.prefs,
        {
          fetch: async () => {
            await held;
            return RESETS;
          },
        },
        clock,
      ),
    );
    await use(settings(true));
    connections.set('claude', { state: 'disconnected' });
    release();
    await flushPromises();
    expect(monitor.current).toBeNull();
    expect(published.filter((data) => data !== null)).toEqual([]);
  });

  it('after a disconnect the watch target stays, so the next interval can read again', async () => {
    await use(settings(true));
    connections.set('claude', { state: 'disconnected' });
    connections.set('claude', { state: 'connected' });
    await flushPromises();
    expect(gateway.fetches).toBe(2);
    expect(clock.activeTimers()).toBe(1);
  });

  it('disconnecting Claude hides the block at once', async () => {
    await use(settings(true));
    expect(monitor.current).not.toBeNull();
    connections.set('claude', { state: 'disconnected' });
    expect(monitor.current).toBeNull();
  });

  it('other status changes and other connections do not trigger a read', async () => {
    await use(settings(true));
    connections.set('claude', { state: 'checking' });
    connections.set('claude', { state: 'connected' });
    connections.set('github', { state: 'disconnected' });
    connections.set('github', { state: 'connected' });
    await flushPromises();
    expect(gateway.fetches).toBe(1);
  });

  it('reconnecting with the block off, or the page off, reads nothing', async () => {
    connections.set('claude', { state: 'disconnected' });
    await use(settings(false));
    connections.set('claude', { state: 'connected' });
    connections.set('claude', { state: 'disconnected' });
    await use(settings(true), false);
    connections.set('claude', { state: 'connected' });
    await flushPromises();
    expect(gateway.fetches).toBe(0);
  });

  it('a reconnect during a backoff does not skip it', async () => {
    gateway.outcome = new RateLimitedError(40 * MINUTE_MS);
    await use(settings(true));
    gateway.outcome = RESETS;
    connections.set('claude', { state: 'disconnected' });
    connections.set('claude', { state: 'connected' });
    await flushPromises();
    expect(gateway.fetches).toBe(1);
  });
});
