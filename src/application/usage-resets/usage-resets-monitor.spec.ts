import { beforeEach, describe, expect, it } from 'vitest';
import { RateLimitedError } from '../../domain/rate-limit';
import type { AppSettings } from '../../domain/settings';
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
      paused: false,
      usableNow: true,
    },
  ],
};

let world: FakeConnectionWorld;
let clock: FakeClock;
let gateway: FakeUsageResetsGateway;
let monitor: UsageResetsMonitor;
let published: (UsageResetsData | null)[];

function settings(resets: boolean, accountId: string | null = FAKE_ACCOUNT.id): AppSettings {
  const base = settingsWithAccounts([FAKE_ACCOUNT, { id: 'account-2', name: 'Work' }], accountId);
  return { ...base, usageBlocks: { ...base.usageBlocks, resets } };
}

async function use(next: AppSettings): Promise<void> {
  world.settings.emitExternalChange(next);
  monitor.sync(next);
  await flushPromises();
}

beforeEach(async () => {
  world = createFakeConnectionWorld();
  clock = new FakeClock();
  await clock.advance(1_800_000_000_000);
  gateway = new FakeUsageResetsGateway();
  gateway.outcome = RESETS;
  monitor = new UsageResetsMonitor(new LoadUsageResets(world.prefs, world.settings, gateway, clock), clock);
  published = [];
  monitor.subscribe((data) => published.push(data));
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
    monitor.sync(settings(true));
    await flushPromises();
    expect(gateway.fetches).toBe(1);
    expect(clock.activeTimers()).toBe(1);
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

  it('an account with no resets publishes nothing', async () => {
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

  it('a result that arrives after the block was turned off is discarded', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = {
      fetch: async () => {
        await held;
        return RESETS;
      },
    };
    monitor = new UsageResetsMonitor(new LoadUsageResets(world.prefs, world.settings, slow, clock), clock);
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
    const slow = {
      fetch: async () => {
        calls += 1;
        await held;
        return RESETS;
      },
    };
    monitor = new UsageResetsMonitor(new LoadUsageResets(world.prefs, world.settings, slow, clock), clock);
    await use(settings(true));
    await clock.advance(2 * USAGE_RESETS_POLL_INTERVAL_MS);
    expect(calls).toBe(1);
    release();
    await flushPromises();
  });

  it('without a loader it never reads', async () => {
    const idle = new UsageResetsMonitor(null, clock);
    idle.sync(settings(true));
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
