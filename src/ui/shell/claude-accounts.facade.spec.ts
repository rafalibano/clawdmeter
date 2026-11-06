import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { createApplication, type Application } from '../../application/application';
import type { PageUpdate } from '../../application/scheduler';
import { FakeClock, flushPromises } from '../../application/testing/fake-clock';
import {
  FAKE_ACCOUNT,
  SIGNED_IN,
  createFakeConnectionWorld,
  settingsWithAccounts,
  type FakeConnectionWorld,
} from '../../application/testing/fake-connection-adapters';
import { fakePage } from '../../application/testing/fake-page';
import { createFakeSkills } from '../../application/testing/fake-skills';
import { FakeUpdateChecker } from '../../application/testing/fake-update-checker';
import { FakeUsageHistoryStores } from '../../application/testing/fake-usage-adapters';
import { RateLimitedError } from '../../domain/rate-limit';
import type { AppSettings, ClaudeAccount } from '../../domain/settings';
import { MINUTE_MS } from '../../domain/time';
import { APPLICATION } from './application.token';
import { ClaudeAccountsFacade } from './claude-accounts.facade';
import { SettingsFacade } from './settings.facade';

const WORK: ClaudeAccount = { id: 'account-2', name: 'Work' };
const OTHER: ClaudeAccount = { id: 'account-3', name: 'Other' };

interface Harness {
  world: FakeConnectionWorld;
  application: Application;
  facade: ClaudeAccountsFacade;
  loads: (string | null)[];
  updates: PageUpdate[];
  usage: { limited: boolean };
  active: () => Promise<string | null>;
}

async function setup(accounts: ClaudeAccount[] = [FAKE_ACCOUNT, WORK]): Promise<Harness> {
  const world = createFakeConnectionWorld();
  world.settings.emitExternalChange(settingsWithAccounts(accounts));
  for (const account of accounts) world.claude.statuses.set(account.id, SIGNED_IN);
  const clock = new FakeClock();
  const loads: (string | null)[] = [];
  const usage = { limited: false };
  const active = async () => (await world.settings.load()).claude.activeAccountId;
  const application = createApplication({
    clock,
    settingsStore: world.settings,
    connectionAdapters: world.adapters,
    usageHistories: new FakeUsageHistoryStores(),
    updateChecker: new FakeUpdateChecker(),
    skills: createFakeSkills(clock),
    newAccountId: () => 'account-new-1',
    pages: [
      fakePage({
        id: 'usage',
        pollIntervalMs: 5 * MINUTE_MS,
        load: async () => {
          const accountId = await active();
          loads.push(accountId);
          if (usage.limited) throw new RateLimitedError();
          return { accountId };
        },
      }),
    ],
  });
  const settings = signal<AppSettings>(await world.settings.load());
  application.updateSettings.subscribe((saved) => settings.set(saved));
  const injector = Injector.create({
    providers: [
      { provide: APPLICATION, useValue: application },
      { provide: SettingsFacade, useValue: { settings } },
    ],
  });
  const updates: PageUpdate[] = [];
  application.scheduler.subscribe((update) => updates.push(update));
  application.scheduler.sync(settings());
  await flushPromises();
  const facade = runInInjectionContext(injector, () => new ClaudeAccountsFacade());
  return { world, application, facade, loads, updates, usage, active };
}

describe('ClaudeAccountsFacade sign-in', () => {
  it('a cancel while the sign-in is still starting ends it as soon as Rust answers, without opening the browser', async () => {
    const { world, facade } = await setup();
    const adding = facade.add('Other');
    expect(facade.login()).toEqual({ kind: 'starting' });
    await facade.cancelLogin();
    expect(await adding).toBe(false);
    expect(world.urls.opened).toEqual([]);
    expect(world.claude.cancelled).toContain('login-1');
    expect(world.claude.completions).toEqual([]);
    expect(facade.loginBusy()).toBe(false);
    expect(facade.failure()).toBeNull();
    expect((await world.settings.load()).claude.accounts).toEqual([FAKE_ACCOUNT, WORK]);
  });

  it('a finished sign-in is announced with the account name', async () => {
    const { facade } = await setup();
    expect(await facade.add('Other')).toBe(true);
    expect(facade.success()).toEqual({ mode: 'add', name: 'Other' });
    expect(await facade.reauthenticate(WORK.id)).toBe(true);
    expect(facade.success()).toEqual({ mode: 'reauthenticate', name: 'Work' });
    facade.clearFailure();
    expect(facade.success()).toBeNull();
  });
});

describe('ClaudeAccountsFacade remove during a sign-in', () => {
  it('refuses to remove any account while a sign-in starts and the account being signed in while it waits', async () => {
    const { world, facade } = await setup();
    world.claude.browser = 'wait';
    const signingIn = facade.reauthenticate(WORK.id);
    expect(await facade.remove(FAKE_ACCOUNT.id)).toBe(false);
    expect(facade.failure()).toMatchObject({ code: 'claude-login-busy' });
    await flushPromises();
    expect(facade.login()).toMatchObject({ kind: 'waiting', name: 'Work' });
    expect(await facade.remove(WORK.id)).toBe(false);
    expect(facade.failure()).toMatchObject({ code: 'claude-login-busy' });
    expect(world.claude.removed).toEqual([]);
    expect(await facade.remove(FAKE_ACCOUNT.id)).toBe(true);
    expect((await world.settings.load()).claude.accounts).toEqual([WORK]);
    await facade.cancelLogin();
    expect(await signingIn).toBe(false);
    expect(world.claude.removed).toEqual([FAKE_ACCOUNT.id]);
  });
});

describe('ClaudeAccountsFacade account switch and the Usage page', () => {
  it('switching accounts during the rate-limit backoff of the previous one loads the new account right away', async () => {
    const { application, facade, loads, updates, usage } = await setup();
    usage.limited = true;
    await application.scheduler.refresh('usage', { resetBackoff: true });
    expect(updates.at(-1)).toMatchObject({ status: 'error', rateLimitedUntil: 5 * MINUTE_MS });
    await application.scheduler.refresh('usage');
    expect(loads).toEqual([FAKE_ACCOUNT.id, FAKE_ACCOUNT.id]);
    usage.limited = false;
    expect(await facade.select(WORK.id)).toBe(true);
    expect(loads).toEqual([FAKE_ACCOUNT.id, FAKE_ACCOUNT.id, WORK.id]);
    expect(updates.at(-1)).toMatchObject({ status: 'ok', data: { accountId: WORK.id } });
    expect(application.scheduler.backoffUntil('usage')).toBeNull();
  });

  it('removing an account that is not the active one keeps the backoff of the active one', async () => {
    const { application, facade, loads, usage } = await setup([FAKE_ACCOUNT, WORK, OTHER]);
    usage.limited = true;
    await application.scheduler.refresh('usage', { resetBackoff: true });
    expect(await facade.remove(OTHER.id)).toBe(true);
    expect(loads).toEqual([FAKE_ACCOUNT.id, FAKE_ACCOUNT.id]);
    expect(application.scheduler.backoffUntil('usage')).toBe(5 * MINUTE_MS);
  });

  it('rapid switches end on the last account picked, whose usage is the last one loaded', async () => {
    const { facade, loads, updates, active } = await setup([FAKE_ACCOUNT, WORK, OTHER]);
    const results = await Promise.all([facade.select(WORK.id), facade.select(OTHER.id)]);
    expect(results).toEqual([true, true]);
    expect(await active()).toBe(OTHER.id);
    expect(loads.at(-1)).toBe(OTHER.id);
    expect(updates.at(-1)).toMatchObject({ status: 'ok', data: { accountId: OTHER.id } });
    expect(facade.busy()).toBe(false);
    expect(facade.failure()).toBeNull();
  });
});
