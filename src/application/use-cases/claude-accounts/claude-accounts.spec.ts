import { beforeEach, describe, expect, it } from 'vitest';
import { CodedError } from '../../../domain/coded-error';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID, type ClaudeAccount } from '../../../domain/settings';
import { createClaudeAccounts, type ClaudeAccounts } from '../../claude-accounts';
import { FakeClock, flushPromises } from '../../testing/fake-clock';
import {
  FAKE_ACCOUNT,
  FakeClaudeAccountGateway,
  FakeUrlOpener,
  SIGNED_IN,
  settingsWithAccounts,
} from '../../testing/fake-connection-adapters';
import { FakeSettingsStore } from '../../testing/fake-settings-store';
import { FakeUsageHistoryStore, FakeUsageHistoryStores } from '../../testing/fake-usage-adapters';
import { UpdateSettings } from '../update-settings';
import type { PendingClaudeLogin } from './claude-login';

const START = 1_800_000_000_000;
const WORK: ClaudeAccount = { id: 'account-2', name: 'Work' };

let settings: FakeSettingsStore;
let gateway: FakeClaudeAccountGateway;
let urls: FakeUrlOpener;
let histories: FakeUsageHistoryStores;
let clock: FakeClock;
let accounts: ClaudeAccounts;
let created = 0;

async function setup(existing: ClaudeAccount[]): Promise<void> {
  settings = new FakeSettingsStore(settingsWithAccounts(existing));
  gateway = new FakeClaudeAccountGateway();
  for (const account of existing) gateway.statuses.set(account.id, SIGNED_IN);
  urls = new FakeUrlOpener();
  histories = new FakeUsageHistoryStores();
  clock = new FakeClock();
  await clock.advance(START);
  created = 0;
  accounts = createClaudeAccounts({
    settings,
    updateSettings: new UpdateSettings(settings),
    gateway,
    urls,
    histories,
    clock,
    newId: () => `account-new-${++created}`,
    loginTimeoutMs: 60_000,
  });
}

async function claude() {
  return (await settings.load()).claude;
}

function capture(): { login: () => PendingClaudeLogin; listener: (login: PendingClaudeLogin) => void } {
  let seen: PendingClaudeLogin | null = null;
  return {
    listener: (login) => {
      seen = login;
    },
    login: () => {
      if (seen === null) throw new Error('no pending login');
      return seen;
    },
  };
}

describe('AddClaudeAccount', () => {
  beforeEach(() => setup([]));

  it('signs in through the browser and only then records the account, active because it is the first', async () => {
    const account = await accounts.add.execute('  Personal ');
    expect(account).toEqual({ id: 'account-new-1', name: 'Personal' });
    expect(gateway.begun).toEqual([DEFAULT_CLAUDE_OAUTH_CLIENT_ID]);
    expect(urls.opened).toEqual(['https://claude.ai/oauth/authorize?state=state-1']);
    expect(gateway.completions).toEqual([{ loginId: 'login-1', accountId: 'account-new-1', timeoutMs: 60_000 }]);
    expect(await claude()).toEqual({
      clientId: DEFAULT_CLAUDE_OAUTH_CLIENT_ID,
      accounts: [{ id: 'account-new-1', name: 'Personal' }],
      activeAccountId: 'account-new-1',
    });
    expect(settings.saved).toHaveLength(1);
  });

  it('uses the client id from the settings', async () => {
    await settings.save({ ...(await settings.load()), claude: { ...(await claude()), clientId: '11111111-2222-4333-8444-555555555555' } });
    await accounts.add.execute('Personal');
    expect(gateway.begun).toEqual(['11111111-2222-4333-8444-555555555555']);
  });

  it('a second account is added without changing the active one', async () => {
    await setup([FAKE_ACCOUNT]);
    await accounts.add.execute('Work');
    expect(await claude()).toMatchObject({
      accounts: [FAKE_ACCOUNT, { id: 'account-new-1', name: 'Work' }],
      activeAccountId: FAKE_ACCOUNT.id,
    });
  });

  it('nothing is written until the browser returns', async () => {
    gateway.browser = 'wait';
    const pending = accounts.add.execute('Personal');
    await flushPromises();
    expect(gateway.isWaiting()).toBe(true);
    expect(settings.saved).toEqual([]);
    gateway.approve();
    expect(await pending).toEqual({ id: 'account-new-1', name: 'Personal' });
    expect(settings.saved).toHaveLength(1);
  });

  it('cancelling writes nothing, cancels the login in Rust and resolves with null', async () => {
    gateway.browser = 'wait';
    const pending = capture();
    const adding = accounts.add.execute('Personal', pending.listener);
    await flushPromises();
    await accounts.cancelLogin.execute(pending.login());
    expect(await adding).toBeNull();
    expect(gateway.cancelled).toContain('login-1');
    expect(settings.saved).toEqual([]);
    expect(pending.login().status()).toBe('cancelled');
  });

  it('a timeout or a Rust error writes nothing, cancels the login and reaches the caller', async () => {
    gateway.browser = new CodedError('claude-login-timeout');
    await expect(accounts.add.execute('Personal')).rejects.toMatchObject({ code: 'claude-login-timeout' });
    expect(gateway.cancelled).toEqual(['login-1']);
    expect(settings.saved).toEqual([]);
  });

  it('a failure to open the browser cancels the login', async () => {
    urls.open = async () => {
      throw new Error('no browser');
    };
    await expect(accounts.add.execute('Personal')).rejects.toThrow('no browser');
    expect(gateway.cancelled).toEqual(['login-1']);
    expect(gateway.completions).toEqual([]);
    expect(settings.saved).toEqual([]);
  });

  it('cancelling right after Rust stored the tokens deletes them and writes nothing', async () => {
    gateway.browser = 'wait';
    const pending = capture();
    const adding = accounts.add.execute('Personal', pending.listener);
    await flushPromises();
    const login = pending.login();
    login.settle('cancelled');
    gateway.approve();
    expect(await adding).toBeNull();
    expect(gateway.removed).toEqual(['account-new-1']);
    expect(settings.saved).toEqual([]);
  });

  it.each([
    ['', 'claude-account-name-empty'],
    ['   ', 'claude-account-name-empty'],
    ['x'.repeat(41), 'claude-account-name-too-long'],
  ])('rejects the name %j with %s before opening the browser', async (name, code) => {
    await expect(accounts.add.execute(name)).rejects.toMatchObject({ code });
    expect(gateway.begun).toEqual([]);
    expect(urls.opened).toEqual([]);
  });

  it('rejects a duplicated name ignoring case', async () => {
    await setup([FAKE_ACCOUNT]);
    await expect(accounts.add.execute('  PERSONAL ')).rejects.toMatchObject({ code: 'claude-account-name-taken' });
    expect(gateway.begun).toEqual([]);
  });

  it('allows at most five accounts', async () => {
    await setup(Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, name: `Account ${index}` })));
    await expect(accounts.add.execute('Sixth')).rejects.toMatchObject({ code: 'claude-account-limit', args: { max: 5 } });
    expect(gateway.begun).toEqual([]);
  });

  it('a name taken while the browser was open is rejected at write time and the new tokens are removed', async () => {
    gateway.browser = 'wait';
    const adding = accounts.add.execute('Work');
    await flushPromises();
    await settings.save(settingsWithAccounts([WORK]));
    gateway.approve();
    await expect(adding).rejects.toMatchObject({ code: 'claude-account-name-taken' });
    expect(gateway.removed).toEqual(['account-new-1']);
    expect((await claude()).accounts).toEqual([WORK]);
  });
});

describe('legacy usage history', () => {
  beforeEach(() => setup([]));

  it('the first account adopts the legacy single-file history', async () => {
    const legacy = new FakeUsageHistoryStore({ fiveHour: [{ at: START - 60_000, utilization: 10, resetsAt: null }], sevenDay: [] }, START - 1);
    histories.legacy = legacy;
    await accounts.add.execute('Personal');
    expect(histories.legacy).toBeNull();
    expect(histories.forAccount('account-new-1')).toBe(legacy);
    expect(await histories.forAccount('account-new-1').importedAt()).toBe(START - 1);
  });

  it('a later account starts with its own history, marked so the ClaudeUsageBar import does not run for it', async () => {
    await accounts.add.execute('Personal');
    histories.legacy = new FakeUsageHistoryStore();
    await accounts.add.execute('Work');
    expect(histories.legacy).not.toBeNull();
    expect(await histories.forAccount('account-new-2').importedAt()).toBe(START);
  });

  it('when the settings cannot be written the adopted history goes back to the legacy file', async () => {
    const legacy = new FakeUsageHistoryStore();
    histories.legacy = legacy;
    settings.fileStatus = 'invalid';
    await expect(accounts.add.execute('Personal')).rejects.toThrow();
    expect(histories.legacy).toBe(legacy);
    expect(gateway.removed).toEqual(['account-new-1']);
  });
});

describe('CompleteClaudeLoginWithCode', () => {
  beforeEach(() => setup([]));

  it('paste mode opens the manual authorize URL', async () => {
    gateway.browser = 'wait';
    const pending = capture();
    void accounts.add.execute('Personal', pending.listener);
    await flushPromises();
    await accounts.openCodePage.execute(pending.login());
    expect(urls.opened).toEqual([
      'https://claude.ai/oauth/authorize?state=state-1',
      'https://claude.ai/oauth/authorize?state=state-1&manual=1',
    ]);
  });

  it('a pasted code completes the login, records the account once and releases the browser wait', async () => {
    gateway.browser = 'wait';
    const pending = capture();
    const adding = accounts.add.execute('Personal', pending.listener);
    await flushPromises();
    const account = await accounts.completeWithCode.execute(pending.login(), '  the-code#state-1 ');
    expect(account).toEqual({ id: 'account-new-1', name: 'Personal' });
    expect(await adding).toEqual(account);
    expect(gateway.completions.at(-1)).toEqual({ loginId: 'login-1', accountId: 'account-new-1', code: 'the-code#state-1' });
    expect(settings.saved).toHaveLength(1);
    expect((await claude()).accounts).toEqual([{ id: 'account-new-1', name: 'Personal' }]);
    expect(gateway.removed).toEqual([]);
  });

  it('an empty code is rejected without calling Rust', async () => {
    gateway.browser = 'wait';
    const pending = capture();
    void accounts.add.execute('Personal', pending.listener);
    await flushPromises();
    await expect(accounts.completeWithCode.execute(pending.login(), '   ')).rejects.toMatchObject({ code: 'claude-login-code-empty' });
    expect(gateway.completions).toHaveLength(1);
  });

  it('a rejected code ends the login without writing and without a second error from the browser wait', async () => {
    gateway.browser = 'wait';
    gateway.pasted = new CodedError('claude-login-failed');
    const pending = capture();
    const adding = accounts.add.execute('Personal', pending.listener);
    await flushPromises();
    await expect(accounts.completeWithCode.execute(pending.login(), 'bad#state')).rejects.toMatchObject({ code: 'claude-login-failed' });
    expect(await adding).toBeNull();
    expect(settings.saved).toEqual([]);
    expect(gateway.cancelled).toContain('login-1');
  });

  it('after the login was cancelled a pasted code is refused', async () => {
    gateway.browser = 'wait';
    const pending = capture();
    const adding = accounts.add.execute('Personal', pending.listener);
    await flushPromises();
    await accounts.cancelLogin.execute(pending.login());
    await adding;
    await expect(accounts.completeWithCode.execute(pending.login(), 'code#state')).rejects.toMatchObject({ code: 'claude-login-cancelled' });
  });
});

describe('ReauthenticateClaudeAccount', () => {
  beforeEach(() => setup([FAKE_ACCOUNT, WORK]));

  it('signs in again for the same account, without touching the settings', async () => {
    gateway.statuses.set(WORK.id, { signedIn: true, expiresAt: null, needsLogin: true });
    expect(await accounts.reauthenticate.execute(WORK.id)).toEqual(WORK);
    expect(gateway.completions).toEqual([{ loginId: 'login-1', accountId: WORK.id, timeoutMs: 60_000 }]);
    expect(await gateway.status(WORK.id)).toMatchObject({ signedIn: true, needsLogin: false });
    expect(settings.saved).toEqual([]);
  });

  it('a cancelled sign-in keeps the account and cancels the login', async () => {
    gateway.browser = 'wait';
    const pending = capture();
    const signingIn = accounts.reauthenticate.execute(WORK.id, pending.listener);
    await flushPromises();
    await accounts.cancelLogin.execute(pending.login());
    expect(await signingIn).toBeNull();
    expect(gateway.removed).toEqual([]);
    expect((await claude()).accounts).toEqual([FAKE_ACCOUNT, WORK]);
  });

  it('an unknown account is refused', async () => {
    await expect(accounts.reauthenticate.execute('gone')).rejects.toMatchObject({ code: 'claude-account-missing' });
    expect(gateway.begun).toEqual([]);
  });
});

describe('RenameClaudeAccount', () => {
  beforeEach(() => setup([FAKE_ACCOUNT, WORK]));

  it('renames trimming the name; the same account may change only the case', async () => {
    expect(await accounts.rename.execute(WORK.id, '  Job ')).toEqual({ id: WORK.id, name: 'Job' });
    await accounts.rename.execute(WORK.id, 'JOB');
    expect((await claude()).accounts).toEqual([FAKE_ACCOUNT, { id: WORK.id, name: 'JOB' }]);
  });

  it('rejects a duplicated, empty or long name and an unknown account', async () => {
    await expect(accounts.rename.execute(WORK.id, 'personal')).rejects.toMatchObject({ code: 'claude-account-name-taken' });
    await expect(accounts.rename.execute(WORK.id, ' ')).rejects.toMatchObject({ code: 'claude-account-name-empty' });
    await expect(accounts.rename.execute(WORK.id, 'y'.repeat(41))).rejects.toMatchObject({ code: 'claude-account-name-too-long' });
    await expect(accounts.rename.execute('gone', 'New')).rejects.toMatchObject({ code: 'claude-account-missing' });
    expect(settings.saved).toEqual([]);
  });
});

describe('RemoveClaudeAccount', () => {
  beforeEach(() => setup([FAKE_ACCOUNT, WORK]));

  it('removing the active account deletes its tokens and history and activates the remaining one', async () => {
    histories.forAccount(FAKE_ACCOUNT.id);
    await accounts.remove.execute(FAKE_ACCOUNT.id);
    expect(gateway.removed).toEqual([FAKE_ACCOUNT.id]);
    expect(histories.removed).toEqual([FAKE_ACCOUNT.id]);
    expect(await claude()).toMatchObject({ accounts: [WORK], activeAccountId: WORK.id });
  });

  it('removing the last account leaves no active account', async () => {
    await accounts.remove.execute(FAKE_ACCOUNT.id);
    await accounts.remove.execute(WORK.id);
    expect(await claude()).toMatchObject({ accounts: [], activeAccountId: null });
  });

  it('a failure deleting the tokens keeps the account', async () => {
    gateway.removeOutcome = new Error('keychain locked');
    await expect(accounts.remove.execute(WORK.id)).rejects.toThrow('keychain locked');
    expect((await claude()).accounts).toEqual([FAKE_ACCOUNT, WORK]);
    expect(histories.removed).toEqual([]);
  });

  it('a failure deleting the history file does not undo the removal', async () => {
    histories.remove = async () => {
      throw new Error('no permission');
    };
    await accounts.remove.execute(WORK.id);
    expect((await claude()).accounts).toEqual([FAKE_ACCOUNT]);
  });

  it('an unknown account is refused without calling Rust', async () => {
    await expect(accounts.remove.execute('gone')).rejects.toMatchObject({ code: 'claude-account-missing' });
    expect(gateway.removed).toEqual([]);
  });
});

describe('SelectClaudeAccount, SetClaudeClientId and ListClaudeAccounts', () => {
  beforeEach(() => setup([FAKE_ACCOUNT, WORK]));

  it('persists the active account', async () => {
    await accounts.select.execute(WORK.id);
    expect((await claude()).activeAccountId).toBe(WORK.id);
    await expect(accounts.select.execute('gone')).rejects.toMatchObject({ code: 'claude-account-missing' });
    expect((await claude()).activeAccountId).toBe(WORK.id);
  });

  it('accepts only a UUID as client id and restores the default with null', async () => {
    expect(await accounts.setClientId.execute(' 11111111-2222-4333-8444-55555555555A ')).toBe('11111111-2222-4333-8444-55555555555a');
    expect((await claude()).clientId).toBe('11111111-2222-4333-8444-55555555555a');
    await expect(accounts.setClientId.execute('not-a-uuid')).rejects.toMatchObject({ code: 'claude-client-id-invalid' });
    expect(await accounts.setClientId.execute(null)).toBe(DEFAULT_CLAUDE_OAUTH_CLIENT_ID);
    expect((await claude()).clientId).toBe(DEFAULT_CLAUDE_OAUTH_CLIENT_ID);
  });

  it('lists every account with its status, and an unknown status when Rust fails', async () => {
    gateway.statuses.set(WORK.id, new Error('keychain locked'));
    expect(await accounts.list.execute()).toEqual({
      clientId: DEFAULT_CLAUDE_OAUTH_CLIENT_ID,
      activeAccountId: FAKE_ACCOUNT.id,
      accounts: [
        { account: FAKE_ACCOUNT, active: true, status: SIGNED_IN },
        { account: WORK, active: false, status: null },
      ],
    });
  });
});
