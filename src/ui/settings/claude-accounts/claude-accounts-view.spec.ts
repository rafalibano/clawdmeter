import { describe, expect, it } from 'vitest';
import { CodedError } from '../../../domain/coded-error';
import { ConnectionProblemError, claudeSignInRequired } from '../../../domain/connections';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID, createDefaultSettings, type ClaudeSettings } from '../../../domain/settings';
import { HOUR_MS } from '../../../domain/time';
import { Localizer } from '../../i18n';
import {
  accountNameProblemText,
  accountStatusView,
  addAccountView,
  claudeAccountRows,
  claudeAccountsSummary,
  CLIENT_ID_CHOICES,
  clientIdView,
  errorText,
  loginStatusText,
  loginText,
  otherClientIdChoice,
  savedClientIdChoice,
} from './claude-accounts-view';

const NOW = 1_800_000_000_000;
const PT = new Localizer('pt-BR');
const EN = new Localizer('en');
const PERSONAL = { id: 'a1', name: 'Personal' };
const WORK = { id: 'a2', name: 'Work' };

function claude(accounts: ClaudeSettings['accounts'], activeAccountId: string | null = accounts[0]?.id ?? null): ClaudeSettings {
  return { ...createDefaultSettings().claude, accounts, activeAccountId };
}

describe('account status', () => {
  it('a healthy account is only "Connected", whatever the expiry, because Rust renews the token by itself', () => {
    for (const expiresAt of [NOW + 2 * HOUR_MS, NOW - 1, null]) {
      expect(accountStatusView({ signedIn: true, expiresAt, needsLogin: false }, PT)).toEqual({ tone: 'ok', text: 'Conectada', needsLogin: false });
    }
    expect(accountStatusView({ signedIn: true, expiresAt: null, needsLogin: false }, EN).text).toBe('Connected');
  });

  it('describes the state, not the action, when Rust needs a login or has no tokens', () => {
    expect(accountStatusView({ signedIn: true, expiresAt: NOW + HOUR_MS, needsLogin: true }, PT)).toEqual({
      tone: 'attention',
      text: 'Sessão expirada',
      needsLogin: true,
    });
    expect(accountStatusView({ signedIn: false, expiresAt: null, needsLogin: false }, EN)).toEqual({
      tone: 'attention',
      text: 'Signed out',
      needsLogin: true,
    });
    expect(accountStatusView({ signedIn: true, expiresAt: null, needsLogin: true }, new Localizer('es-MX')).text).toBe('Sesión vencida');
  });

  it('an unknown status is neither ok nor an alarm', () => {
    expect(accountStatusView(null, EN)).toEqual({ tone: 'unknown', text: 'Status unavailable', needsLogin: false });
    expect(accountStatusView(undefined, EN).tone).toBe('unknown');
  });
});

describe('account list', () => {
  it('one row per account, in order, with the active one marked and its status', () => {
    const statuses = new Map([
      ['a1', { signedIn: true, expiresAt: null, needsLogin: false }],
      ['a2', { signedIn: true, expiresAt: null, needsLogin: true }],
    ]);
    expect(claudeAccountRows(claude([PERSONAL, WORK], 'a2'), statuses, EN)).toEqual([
      { id: 'a1', name: 'Personal', active: false, tone: 'ok', text: 'Connected', needsLogin: false },
      { id: 'a2', name: 'Work', active: true, tone: 'attention', text: 'Session expired', needsLogin: true },
    ]);
  });

  it('summary shows the active account and how many there are', () => {
    expect(claudeAccountsSummary(claude([PERSONAL, WORK], 'a2'), PT)).toBe('Work · 2 de 5');
    expect(claudeAccountsSummary(claude([]), EN)).toBe('No accounts');
  });
});

describe('add account', () => {
  it('is disabled with an explanation at five accounts and while a sign-in is open', () => {
    const five = Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, name: `N${index}` }));
    expect(addAccountView(claude(five), false)).toEqual({ disabled: true, limitReached: true });
    expect(addAccountView(claude([PERSONAL]), true)).toEqual({ disabled: true, limitReached: false });
    expect(addAccountView(claude([PERSONAL]), false)).toEqual({ disabled: false, limitReached: false });
  });

  it('describes the sign-in in progress', () => {
    expect(loginText({ kind: 'starting' }, EN)).toBe('Opening the browser…');
    expect(loginText({ kind: 'waiting', mode: 'add', name: 'Work', pasting: false, submitting: false }, PT)).toBe(
      'Aguardando o navegador para fazer login em Work…',
    );
    expect(loginText({ kind: 'waiting', mode: 'reauthenticate', name: 'Work', pasting: true, submitting: false }, EN)).toBe(
      'Waiting for the browser to sign in to Work again…',
    );
  });
});

describe('one status line for the sign-in', () => {
  it('says what is going on while signing in and how it ended, and nothing otherwise', () => {
    expect(loginStatusText({ kind: 'starting' }, { mode: 'add', name: 'Old' }, EN)).toBe('Opening the browser…');
    expect(loginStatusText(null, { mode: 'add', name: 'Work' }, PT)).toBe('Work adicionada.');
    expect(loginStatusText(null, { mode: 'reauthenticate', name: 'Work' }, PT)).toBe('Work conectada de novo.');
    expect(loginStatusText(null, { mode: 'reauthenticate', name: 'Work' }, EN)).toBe('Work connected again.');
    expect(loginStatusText(null, null, EN)).toBe('');
  });

  it('explains a name problem before the browser opens', () => {
    expect(accountNameProblemText('empty', PT)).toBe('Digite um nome para a conta.');
    expect(accountNameProblemText('too-long', EN)).toBe('Use up to 40 characters in the name.');
    expect(accountNameProblemText('taken', EN)).toBe('There is already an account with this name.');
  });
});

describe('client id choice', () => {
  const CUSTOM = '11111111-2222-4333-8444-555555555555';
  const OTHER = '22222222-3333-4444-8555-666666666666';
  const DEFAULT_MODE = { useDefaultClientId: true, clientId: '' };
  const CUSTOM_MODE = { useDefaultClientId: false, clientId: CUSTOM };
  const NO_DRAFT = { choice: null, value: null };

  it('is "Yes" by default, without the field and without the default id anywhere in the view', () => {
    const view = clientIdView(DEFAULT_MODE, NO_DRAFT, false);
    expect(view).toEqual({ choice: 'default', showField: false, value: '', invalid: false, canSave: false, pending: false, disabled: false });
    expect(JSON.stringify(view)).not.toContain(DEFAULT_CLAUDE_OAUTH_CLIENT_ID);
    expect(savedClientIdChoice(DEFAULT_MODE)).toBe('default');
    expect(CLIENT_ID_CHOICES).toEqual(['default', 'custom']);
  });

  it('choosing "No" shows the field without saving yet: the default stays in use until a valid UUID is saved', () => {
    expect(clientIdView(DEFAULT_MODE, { choice: 'custom', value: null }, false)).toMatchObject({
      choice: 'custom',
      showField: true,
      value: '',
      invalid: false,
      canSave: false,
      pending: true,
    });
    expect(clientIdView(DEFAULT_MODE, { choice: 'custom', value: 'nope' }, false)).toMatchObject({ invalid: true, canSave: false, pending: true });
    expect(clientIdView(DEFAULT_MODE, { choice: 'custom', value: ` ${CUSTOM.toUpperCase()} ` }, false)).toMatchObject({
      invalid: false,
      canSave: true,
    });
  });

  it('the custom id already stored fills the field when "No" is chosen again', () => {
    const stored = { useDefaultClientId: true, clientId: CUSTOM };
    expect(clientIdView(stored, NO_DRAFT, false)).toMatchObject({ choice: 'default', showField: false });
    expect(clientIdView(stored, { choice: 'custom', value: null }, false)).toMatchObject({ showField: true, value: CUSTOM, canSave: true, pending: true });
  });

  it('a saved custom id shows "No" with the field, and only a different valid UUID can be saved', () => {
    expect(savedClientIdChoice(CUSTOM_MODE)).toBe('custom');
    expect(clientIdView(CUSTOM_MODE, NO_DRAFT, false)).toEqual({
      choice: 'custom',
      showField: true,
      value: CUSTOM,
      invalid: false,
      canSave: false,
      pending: false,
      disabled: false,
    });
    expect(clientIdView(CUSTOM_MODE, { choice: null, value: CUSTOM.toUpperCase() }, false).canSave).toBe(false);
    expect(clientIdView(CUSTOM_MODE, { choice: null, value: OTHER }, false).canSave).toBe(true);
    expect(clientIdView(CUSTOM_MODE, { choice: null, value: '' }, false)).toMatchObject({ invalid: false, canSave: false });
  });

  it('choosing "Yes" hides the field whatever the draft', () => {
    expect(clientIdView(CUSTOM_MODE, { choice: 'default', value: 'nope' }, false)).toMatchObject({
      choice: 'default',
      showField: false,
      invalid: false,
      canSave: false,
      pending: false,
    });
  });

  it('is disabled while a sign-in is in progress', () => {
    expect(clientIdView(DEFAULT_MODE, NO_DRAFT, true).disabled).toBe(true);
    expect(clientIdView(CUSTOM_MODE, { choice: null, value: OTHER }, true)).toMatchObject({ disabled: true, canSave: false });
  });

  it('the arrows move between the two options', () => {
    expect(otherClientIdChoice('default')).toBe('custom');
    expect(otherClientIdChoice('custom')).toBe('default');
  });

  it('an invalid id says what to paste with a neutral mask', () => {
    expect(errorText(new CodedError('claude-client-id-invalid'), PT)).toBe('Cole o ID inteiro, no formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.');
    expect(errorText(new CodedError('claude-client-id-invalid'), EN)).toBe('Paste the whole ID, in the format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.');
  });
});

describe('error text', () => {
  it('coded errors and connection problems are translated', () => {
    expect(errorText(new CodedError('claude-account-limit', { max: 5 }), PT)).toBe('Você pode ter até 5 contas.');
    expect(errorText(claudeSignInRequired('Work'), EN)).toBe('Sign in to the Work account again.');
    expect(errorText(new ConnectionProblemError('unexpected', 'locked', 'keychain-unavailable'), EN)).toBe(
      'Could not access the system keychain.',
    );
    expect(errorText(new ConnectionProblemError('claude-no-account'), EN)).toBe(
      'No Claude account yet. Add one in Settings > Claude accounts.',
    );
  });

  it('other errors keep their message', () => {
    expect(errorText(new Error('boom'), EN)).toBe('boom');
    expect(errorText('plain', EN)).toBe('plain');
  });
});
