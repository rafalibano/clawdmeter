import { beforeEach, describe, expect, it } from 'vitest';
import type { UsageResets } from '../../../domain/usage';
import { FakeClock } from '../../testing/fake-clock';
import { createFakeConnectionWorld, type FakeConnectionWorld } from '../../testing/fake-connection-adapters';
import { FakeUsageResetsGateway } from '../../testing/fake-usage-adapters';
import { LoadUsageResets } from './load-usage-resets';

const START = 1_800_000_000_000;
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TARGET = { accountId: 'account-1', clientId: CLIENT_ID };

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
      clearsScoped: [],
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
  load = new LoadUsageResets(world.prefs, gateway, clock);
});

describe('LoadUsageResets', () => {
  it('reads the resets of the account it is given with that client id and tags them with the account and the time', async () => {
    const data = await load.execute(TARGET);
    expect(gateway.requests).toEqual([{ accountId: 'account-1', clientId: CLIENT_ID }]);
    expect(data).toEqual({ accountId: 'account-1', at: START, resets: RESETS });
  });

  it('does not read the settings file: what the caller passes is what is used', async () => {
    await load.execute({ accountId: 'account-9', clientId: '11111111-2222-4333-8444-555555555555' });
    expect(gateway.requests).toEqual([{ accountId: 'account-9', clientId: '11111111-2222-4333-8444-555555555555' }]);
  });

  it('with the Claude connection off it makes no request', async () => {
    world.prefs.current = { ...world.prefs.current, claude: { ...world.prefs.current.claude, enabled: false } };
    await expect(load.execute(TARGET)).resolves.toBeNull();
    expect(gateway.fetches).toBe(0);
  });

  it('an account without resets gives data with no resets', async () => {
    gateway.outcome = null;
    await expect(load.execute(TARGET)).resolves.toEqual({ accountId: 'account-1', at: START, resets: null });
  });

  it('a gateway failure is thrown to the caller', async () => {
    gateway.outcome = new Error('boom');
    await expect(load.execute(TARGET)).rejects.toThrow('boom');
  });
});
