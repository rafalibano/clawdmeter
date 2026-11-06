import { describe, expect, it } from 'vitest';
import { CodedError } from '../../../domain/coded-error';
import { ConnectionProblemError, claudeSignInRequired } from '../../../domain/connections';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID, createDefaultSettings, type ClaudeSettings } from '../../../domain/settings';
import { HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { Localizer } from '../../i18n';
import {
  accountStatusView,
  addAccountView,
  claudeAccountRows,
  claudeAccountsSummary,
  clientIdView,
  errorText,
  loginText,
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
  it('connected with the time until the token expires', () => {
    expect(accountStatusView({ signedIn: true, expiresAt: NOW + 2 * HOUR_MS + 6 * MINUTE_MS, needsLogin: false }, NOW, PT)).toEqual({
      tone: 'ok',
      text: 'Conectada · expira em 2h06',
      needsLogin: false,
    });
  });

  it('connected without a known expiry, or already past it but still renewable', () => {
    expect(accountStatusView({ signedIn: true, expiresAt: null, needsLogin: false }, NOW, EN).text).toBe('Connected');
    expect(accountStatusView({ signedIn: true, expiresAt: NOW - 1, needsLogin: false }, NOW, EN).text).toBe('Connected');
  });

  it('asks to sign in again when Rust needs a login or has no tokens', () => {
    for (const status of [
      { signedIn: true, expiresAt: NOW + HOUR_MS, needsLogin: true },
      { signedIn: false, expiresAt: null, needsLogin: false },
    ]) {
      expect(accountStatusView(status, NOW, PT)).toEqual({ tone: 'attention', text: 'Entre de novo', needsLogin: true });
    }
  });

  it('an unknown status is neither ok nor an alarm', () => {
    expect(accountStatusView(null, NOW, EN)).toEqual({ tone: 'unknown', text: 'Status unavailable', needsLogin: false });
    expect(accountStatusView(undefined, NOW, EN).tone).toBe('unknown');
  });
});

describe('account list', () => {
  it('one row per account, in order, with the active one marked and its status', () => {
    const statuses = new Map([
      ['a1', { signedIn: true, expiresAt: null, needsLogin: false }],
      ['a2', { signedIn: true, expiresAt: null, needsLogin: true }],
    ]);
    expect(claudeAccountRows(claude([PERSONAL, WORK], 'a2'), statuses, NOW, EN)).toEqual([
      { id: 'a1', name: 'Personal', active: false, tone: 'ok', text: 'Connected', needsLogin: false },
      { id: 'a2', name: 'Work', active: true, tone: 'attention', text: 'Sign in again', needsLogin: true },
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
      'Aguardando o navegador para entrar em Work…',
    );
    expect(loginText({ kind: 'waiting', mode: 'reauthenticate', name: 'Work', pasting: true, submitting: false }, EN)).toBe(
      'Waiting for the browser to sign in to Work again…',
    );
  });
});

describe('client id field', () => {
  it('validates the draft as a UUID and only saves a different valid value', () => {
    expect(clientIdView(null, DEFAULT_CLAUDE_OAUTH_CLIENT_ID)).toEqual({
      value: DEFAULT_CLAUDE_OAUTH_CLIENT_ID,
      invalid: false,
      canSave: false,
      isDefault: true,
    });
    expect(clientIdView('nope', DEFAULT_CLAUDE_OAUTH_CLIENT_ID)).toMatchObject({ invalid: true, canSave: false });
    expect(clientIdView('11111111-2222-4333-8444-555555555555', DEFAULT_CLAUDE_OAUTH_CLIENT_ID)).toMatchObject({
      invalid: false,
      canSave: true,
    });
    expect(clientIdView(null, '11111111-2222-4333-8444-555555555555').isDefault).toBe(false);
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
