import type { ClaudeAccountStatus } from '../../../application/ports';
import type { ClaudeLoginMode } from '../../../application/use-cases';
import { CodedError } from '../../../domain/coded-error';
import { ConnectionProblemError } from '../../../domain/connections';
import {
  DEFAULT_CLAUDE_OAUTH_CLIENT_ID,
  MAX_CLAUDE_ACCOUNTS,
  MAX_CLAUDE_ACCOUNT_NAME,
  activeClaudeAccount,
  normalizeClientId,
  type ClaudeAccountNameProblem,
  type ClaudeSettings,
} from '../../../domain/settings';
import type { Localizer } from '../../i18n';

export type ClaudeAccountTone = 'ok' | 'attention' | 'unknown';

export interface ClaudeAccountStatusView {
  tone: ClaudeAccountTone;
  text: string;
  needsLogin: boolean;
}

export interface ClaudeAccountRow extends ClaudeAccountStatusView {
  id: string;
  name: string;
  active: boolean;
}

export interface AddAccountView {
  disabled: boolean;
  limitReached: boolean;
}

export interface ClientIdView {
  value: string;
  invalid: boolean;
  canSave: boolean;
  isDefault: boolean;
  dirty: boolean;
}

export type ClaudeLoginView =
  | { kind: 'starting' }
  | { kind: 'waiting'; mode: ClaudeLoginMode; name: string; pasting: boolean; submitting: boolean };

export interface ClaudeLoginSuccess {
  mode: ClaudeLoginMode;
  name: string;
}

export function accountStatusView(status: ClaudeAccountStatus | null | undefined, l: Localizer): ClaudeAccountStatusView {
  if (status === null || status === undefined) return { tone: 'unknown', text: l.t('claudeAccounts.status.unknown'), needsLogin: false };
  if (!status.signedIn) return { tone: 'attention', text: l.t('claudeAccounts.status.signedOut'), needsLogin: true };
  if (status.needsLogin) return { tone: 'attention', text: l.t('claudeAccounts.status.expired'), needsLogin: true };
  return { tone: 'ok', text: l.t('claudeAccounts.status.connected'), needsLogin: false };
}

export function claudeAccountRows(
  claude: ClaudeSettings,
  statuses: ReadonlyMap<string, ClaudeAccountStatus | null>,
  l: Localizer,
): ClaudeAccountRow[] {
  return claude.accounts.map((account) => ({
    id: account.id,
    name: account.name,
    active: account.id === claude.activeAccountId,
    ...accountStatusView(statuses.get(account.id), l),
  }));
}

export function addAccountView(claude: ClaudeSettings, loginBusy: boolean): AddAccountView {
  const limitReached = claude.accounts.length >= MAX_CLAUDE_ACCOUNTS;
  return { disabled: limitReached || loginBusy, limitReached };
}

export function claudeAccountsSummary(claude: ClaudeSettings, l: Localizer): string {
  const active = activeClaudeAccount(claude);
  if (active === null) return l.t('claudeAccounts.summary.none');
  return l.t('claudeAccounts.summary.count', { active: active.name, count: claude.accounts.length, max: MAX_CLAUDE_ACCOUNTS });
}

export function clientIdView(draft: string | null, current: string): ClientIdView {
  const value = draft ?? current;
  const normalized = normalizeClientId(value);
  return {
    value,
    invalid: normalized === null,
    canSave: normalized !== null && normalized !== current,
    isDefault: current === DEFAULT_CLAUDE_OAUTH_CLIENT_ID,
    dirty: draft !== null && draft !== current,
  };
}

export function loginText(login: ClaudeLoginView, l: Localizer): string {
  if (login.kind === 'starting') return l.t('claudeAccounts.starting');
  return l.t(login.mode === 'add' ? 'claudeAccounts.waiting.add' : 'claudeAccounts.waiting.reauthenticate', { name: login.name });
}

export function loginStatusText(login: ClaudeLoginView | null, success: ClaudeLoginSuccess | null, l: Localizer): string {
  if (login !== null) return loginText(login, l);
  if (success === null) return '';
  return l.t(success.mode === 'add' ? 'claudeAccounts.added' : 'claudeAccounts.reconnected', { name: success.name });
}

export function accountNameProblemText(problem: ClaudeAccountNameProblem, l: Localizer): string {
  switch (problem) {
    case 'empty':
      return l.t('error.claude-account-name-empty');
    case 'too-long':
      return l.t('error.claude-account-name-too-long', { max: MAX_CLAUDE_ACCOUNT_NAME });
    case 'taken':
      return l.t('error.claude-account-name-taken');
  }
}

export function errorText(error: unknown, l: Localizer): string {
  if (error instanceof CodedError) return l.t(`error.${error.code}`, error.args);
  if (error instanceof ConnectionProblemError) {
    if (error.code !== undefined) return l.t(`error.${error.code}`, error.args);
    return l.t(`problem.${error.problem}`, { org: '' });
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
