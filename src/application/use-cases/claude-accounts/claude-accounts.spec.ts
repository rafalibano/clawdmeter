import { beforeEach, describe, expect, it } from 'vitest';
import { CodedError } from '../../../domain/coded-error';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID, type ClaudeAccount } from '../../../domain/settings';
import { createClaudeAccounts, type ClaudeAccounts } from '../../claude-accounts';
import { SettingsWriteBlockedError } from '../../ports';
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
const CUSTOM_CLIENT_ID = '11111111-2222-4333-8444-55555555555a';

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
      useDefaultClientId: true,
      clientId: '',
      accounts: [{ id: 'account-new-1', name: 'Personal' }],
      activeAccountId: 'account-new-1',
    });
    expect(settings.saved).toHaveLength(1);
  });

  it('signs in with the custom client id when the default is off, and with the default when it is on', async () => {
    await accounts.setClientIdMode.execute({ useDefault: false, clientId: CUSTOM_CLIENT_ID });
    await accounts.add.execute('Personal');
    await accounts.setClientIdMode.execute({ useDefault: true });
    await accounts.add.execute('Work');
    expect(gateway.begun).toEqual([CUSTOM_CLIENT_ID, DEFAULT_CLAUDE_OAUTH_CLIENT_ID]);
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

  it('a cancel requested while Rust was still starting the sign-in never opens the browser', async () => {
    const adding = accounts.add.execute('Personal', (login) => void accounts.cancelLogin.execute(login));
    expect(await adding).toBeNull();
    expect(urls.opened).toEqual([]);
    expect(gateway.cancelled).toContain('login-1');
    expect(gateway.completions).toEqual([]);
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
    await expect(accounts.add.execute('Personal')).rejects.toBeInstanceOf(SettingsWriteBlockedError);
    expect(histories.legacy).toBe(legacy);
    expect(gateway.removed).toEqual(['account-new-1']);
  });

  it('when the settings cannot be written for a later account its new history and tokens are removed', async () => {
    await setup([FAKE_ACCOUNT]);
    settings.fileStatus = 'invalid';
    await expect(accounts.add.execute('Work')).rejects.toMatchObject({ reason: 'invalid' });
    expect(histories.removed).toEqual(['account-new-1']);
    expect(gateway.removed).toEqual(['account-new-1']);
    expect((await claude()).accounts).toEqual([FAKE_ACCOUNT]);
  });

  it('a failure marking the history of a later account as imported undoes the sign-in', async () => {
    await setup([FAKE_ACCOUNT]);
    histories.forAccount('account-new-1').markImported = async () => {
      throw new Error('disk full');
    };
    await expect(accounts.add.execute('Work')).rejects.toThrow('disk full');
    expect(histories.removed).toEqual(['account-new-1']);
    expect(gateway.removed).toEqual(['account-new-1']);
    expect(settings.saved).toEqual([]);
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
    expect(gateway.cancelled).toContain('login-1');
  });

  it('an empty code is rejected without calling Rust', async () => {
    gateway.browser = 'wait';
    const pending = capture();
    void accounts.add.execute('Personal', pending.listener);
    await flushPromises();
    await expect(accounts.completeWithCode.execute(pending.login(), '   ')).rejects.toMatchObject({ code: 'claude-login-code-empty' });
    expect(gateway.completions).toHaveLength(1);
  });

  it('a code refused by the token exchange ends the login without writing and without a second error from the browser wait', async () => {
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

  it('a code of another sign-in keeps the login alive, so the browser timeout that follows still reaches the caller', async () => {
    gateway.browser = 'wait';
    gateway.pasted = new CodedError('claude-login-code-invalid');
    const pending = capture();
    const adding = accounts.add.execute('Personal', pending.listener);
    await flushPromises();
    await expect(accounts.completeWithCode.execute(pending.login(), 'wrong#state')).rejects.toMatchObject({ code: 'claude-login-code-invalid' });
    expect(gateway.isWaiting()).toBe(true);
    expect(pending.login().status()).toBe('waiting');
    gateway.fail(new CodedError('claude-login-timeout'));
    await expect(adding).rejects.toMatchObject({ code: 'claude-login-timeout' });
    expect(gateway.cancelled).toContain('login-1');
    expect(settings.saved).toEqual([]);
  });

  it('after a code of another sign-in, the right code still completes the login', async () => {
    gateway.browser = 'wait';
    gateway.pasted = new CodedError('claude-login-code-invalid');
    const pending = capture();
    const adding = accounts.add.execute('Personal', pending.listener);
    await flushPromises();
    await expect(accounts.completeWithCode.execute(pending.login(), 'wrong#state')).rejects.toMatchObject({ code: 'claude-login-code-invalid' });
    gateway.pasted = { expiresAt: SIGNED_IN.expiresAt, email: null };
    expect(await accounts.completeWithCode.execute(pending.login(), 'the-code#state-1')).toEqual({ id: 'account-new-1', name: 'Personal' });
    expect(await adding).toEqual({ id: 'account-new-1', name: 'Personal' });
    expect(settings.saved).toHaveLength(1);
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
    expect(gateway.begun).toEqual([DEFAULT_CLAUDE_OAUTH_CLIENT_ID]);
  });

  it('signs in again with the custom client id when the default is off', async () => {
    await accounts.setClientIdMode.execute({ useDefault: false, clientId: CUSTOM_CLIENT_ID });
    await accounts.reauthenticate.execute(WORK.id);
    expect(gateway.begun).toEqual([CUSTOM_CLIENT_ID]);
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

  it('a cancel that arrives after Rust stored the new tokens resolves with null and keeps them for the account', async () => {
    gateway.browser = 'wait';
    const pending = capture();
    const signingIn = accounts.reauthenticate.execute(WORK.id, pending.listener);
    await flushPromises();
    pending.login().settle('cancelled');
    gateway.approve();
    expect(await signingIn).toBeNull();
    expect(gateway.removed).toEqual([]);
    expect((await claude()).accounts).toEqual([FAKE_ACCOUNT, WORK]);
  });

  it('removing the account during its sign-in cancels the sign-in and leaves no tokens in Rust', async () => {
    gateway.browser = 'wait';
    const signingIn = accounts.reauthenticate.execute(WORK.id);
    await flushPromises();
    await accounts.remove.execute(WORK.id);
    expect(gateway.cancelled).toContain('login-1');
    gateway.approve();
    expect(await signingIn).toBeNull();
    expect(gateway.statuses.has(WORK.id)).toBe(false);
    expect((await claude()).accounts).toEqual([FAKE_ACCOUNT]);
  });

  it('tokens stored for an account that left the settings during the sign-in are deleted', async () => {
    gateway.browser = 'wait';
    const signingIn = accounts.reauthenticate.execute(WORK.id);
    await flushPromises();
    settings.emitExternalChange(settingsWithAccounts([FAKE_ACCOUNT]));
    gateway.approve();
    expect(await signingIn).toBeNull();
    expect(gateway.removed).toEqual([WORK.id]);
    expect(gateway.statuses.has(WORK.id)).toBe(false);
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

describe('SelectClaudeAccount, SetClaudeClientIdMode and ListClaudeAccounts', () => {
  beforeEach(() => setup([FAKE_ACCOUNT, WORK]));

  it('persists the active account', async () => {
    await accounts.select.execute(WORK.id);
    expect((await claude()).activeAccountId).toBe(WORK.id);
    await expect(accounts.select.execute('gone')).rejects.toMatchObject({ code: 'claude-account-missing' });
    expect((await claude()).activeAccountId).toBe(WORK.id);
  });

  const clientIdMode = async () => {
    const { useDefaultClientId, clientId } = await claude();
    return { useDefaultClientId, clientId };
  };

  it('turns the default off only with a valid UUID, stored in lowercase', async () => {
    expect(await accounts.setClientIdMode.execute({ useDefault: false, clientId: ' 11111111-2222-4333-8444-55555555555A ' })).toBe(CUSTOM_CLIENT_ID);
    expect(await clientIdMode()).toEqual({ useDefaultClientId: false, clientId: CUSTOM_CLIENT_ID });
    expect(settings.saved).toHaveLength(1);
  });

  it('refuses to turn the default off with an invalid or empty id and writes nothing', async () => {
    for (const clientId of ['not-a-uuid', '', '   ']) {
      await expect(accounts.setClientIdMode.execute({ useDefault: false, clientId })).rejects.toMatchObject({ code: 'claude-client-id-invalid' });
    }
    expect(await clientIdMode()).toEqual({ useDefaultClientId: true, clientId: '' });
    expect(settings.saved).toEqual([]);
  });

  it('turning the default on persists right away and keeps the custom id stored', async () => {
    await accounts.setClientIdMode.execute({ useDefault: false, clientId: CUSTOM_CLIENT_ID });
    expect(await accounts.setClientIdMode.execute({ useDefault: true })).toBe(DEFAULT_CLAUDE_OAUTH_CLIENT_ID);
    expect(await clientIdMode()).toEqual({ useDefaultClientId: true, clientId: CUSTOM_CLIENT_ID });
  });

  it('changes the custom id while the default is off, validating the new one', async () => {
    await accounts.setClientIdMode.execute({ useDefault: false, clientId: CUSTOM_CLIENT_ID });
    const other = '22222222-3333-4444-8555-666666666666';
    expect(await accounts.setClientIdMode.execute({ useDefault: false, clientId: other })).toBe(other);
    await expect(accounts.setClientIdMode.execute({ useDefault: false, clientId: 'oops' })).rejects.toMatchObject({ code: 'claude-client-id-invalid' });
    expect(await clientIdMode()).toEqual({ useDefaultClientId: false, clientId: other });
  });

  it('lists every account with its status, and an unknown status when Rust fails', async () => {
    gateway.statuses.set(WORK.id, new Error('keychain locked'));
    expect(await accounts.list.execute()).toMatchObject({ clientId: DEFAULT_CLAUDE_OAUTH_CLIENT_ID });
    await accounts.setClientIdMode.execute({ useDefault: false, clientId: CUSTOM_CLIENT_ID });
    expect(await accounts.list.execute()).toEqual({
      clientId: CUSTOM_CLIENT_ID,
      activeAccountId: FAKE_ACCOUNT.id,
      accounts: [
        { account: FAKE_ACCOUNT, active: true, status: SIGNED_IN },
        { account: WORK, active: false, status: null },
      ],
    });
  });
});
