import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID } from '../../../domain/settings';
import type { UsageResets } from '../../../domain/usage';
import { FakeClock } from '../../testing/fake-clock';
import { FAKE_ACCOUNT, createFakeConnectionWorld, settingsWithAccounts, type FakeConnectionWorld } from '../../testing/fake-connection-adapters';
import { FakeUsageResetsGateway } from '../../testing/fake-usage-adapters';
import { LoadUsageResets } from './load-usage-resets';

const START = 1_800_000_000_000;

const RESETS: UsageResets = {
  atLimit: false,
  exhausted: [],
  grants: [
    {
      id: 'g1',
      label: null,
      type: 'session',
      resetsLeft: 1,
      resetsTotal: 1,
      startsAt: null,
      endsAt: START + 1_000,
      clears: ['fiveHour'],
      paused: false,
      usableNow: true,
    },
  ],
};

let world: FakeConnectionWorld;
let clock: FakeClock;
let gateway: FakeUsageResetsGateway;
let load: LoadUsageResets;

beforeEach(async () => {
  world = createFakeConnectionWorld();
  clock = new FakeClock();
  await clock.advance(START);
  gateway = new FakeUsageResetsGateway();
  gateway.outcome = RESETS;
  load = new LoadUsageResets(world.prefs, world.settings, gateway, clock);
});

describe('LoadUsageResets', () => {
  it('reads the resets of the active account with the effective client id and tags them with the account and the time', async () => {
    const data = await load.execute();
    expect(gateway.requests).toEqual([{ accountId: FAKE_ACCOUNT.id, clientId: DEFAULT_CLAUDE_OAUTH_CLIENT_ID }]);
    expect(data).toEqual({ accountId: FAKE_ACCOUNT.id, at: START, resets: RESETS });
  });

  it('with the resets block off it makes no request at all', async () => {
    const base = settingsWithAccounts([FAKE_ACCOUNT]);
    world.settings.emitExternalChange({ ...base, usageBlocks: { ...base.usageBlocks, resets: false } });
    await expect(load.execute()).resolves.toBeNull();
    expect(gateway.fetches).toBe(0);
  });

  it('only the resets switch matters: the other blocks off do not stop the read', async () => {
    const base = settingsWithAccounts([FAKE_ACCOUNT]);
    world.settings.emitExternalChange({ ...base, usageBlocks: { modelLimits: false, extraUsage: false, resets: true } });
    await load.execute();
    expect(gateway.fetches).toBe(1);
  });

  it('without an active account it makes no request and reports no error', async () => {
    world.settings.emitExternalChange(settingsWithAccounts([]));
    await expect(load.execute()).resolves.toBeNull();
    expect(gateway.fetches).toBe(0);
  });

  it('with the Claude connection off it makes no request', async () => {
    world.prefs.current = { ...world.prefs.current, claude: { ...world.prefs.current.claude, enabled: false } };
    await expect(load.execute()).resolves.toBeNull();
    expect(gateway.fetches).toBe(0);
  });

  it('an account without resets gives data with no resets', async () => {
    gateway.outcome = null;
    await expect(load.execute()).resolves.toEqual({ accountId: FAKE_ACCOUNT.id, at: START, resets: null });
  });

  it('a gateway failure is thrown to the caller', async () => {
    gateway.outcome = new Error('boom');
    await expect(load.execute()).rejects.toThrow('boom');
  });
});
