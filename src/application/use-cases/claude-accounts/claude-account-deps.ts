import { CodedError } from '../../../domain/coded-error';
import {
  MAX_CLAUDE_ACCOUNTS,
  MAX_CLAUDE_ACCOUNT_NAME,
  accountNameProblem,
  cleanAccountName,
  type ClaudeAccount,
  type ClaudeAccountNameProblem,
} from '../../../domain/settings';
import type { ClaudeAccountGateway, Clock, SettingsStore, UrlOpener, UsageHistoryStores } from '../../ports';
import type { UpdateSettings } from '../update-settings';

export const CLAUDE_LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface ClaudeAccountDeps {
  settings: Pick<SettingsStore, 'load'>;
  updateSettings: Pick<UpdateSettings, 'execute'>;
  gateway: ClaudeAccountGateway;
  urls: UrlOpener;
  histories: UsageHistoryStores;
  clock: Clock;
  newId: () => string;
  loginTimeoutMs?: number;
}

function nameError(problem: ClaudeAccountNameProblem): CodedError {
  switch (problem) {
    case 'empty':
      return new CodedError('claude-account-name-empty');
    case 'too-long':
      return new CodedError('claude-account-name-too-long', { max: MAX_CLAUDE_ACCOUNT_NAME });
    case 'taken':
      return new CodedError('claude-account-name-taken');
  }
}

export function checkedName(name: string, accounts: readonly ClaudeAccount[], exceptId: string | null = null): string {
  const problem = accountNameProblem(name, accounts, exceptId);
  if (problem !== null) throw nameError(problem);
  return cleanAccountName(name);
}

export function checkedNewAccount(name: string, accounts: readonly ClaudeAccount[]): string {
  if (accounts.length >= MAX_CLAUDE_ACCOUNTS) throw new CodedError('claude-account-limit', { max: MAX_CLAUDE_ACCOUNTS });
  return checkedName(name, accounts);
}

export function requireAccount(accounts: readonly ClaudeAccount[], accountId: string): ClaudeAccount {
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (account === undefined) throw new CodedError('claude-account-missing');
  return account;
}
