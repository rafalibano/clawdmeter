export const DEFAULT_CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export const MAX_CLAUDE_ACCOUNTS = 5;

export const MAX_CLAUDE_ACCOUNT_NAME = 40;

export interface ClaudeAccount {
  id: string;
  name: string;
}

export interface ClaudeSettings {
  useDefaultClientId: boolean;
  clientId: string;
  accounts: ClaudeAccount[];
  activeAccountId: string | null;
}

export type ClaudeAccountNameProblem = 'empty' | 'too-long' | 'taken';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ID = /^[A-Za-z0-9-]{1,64}$/;

export type ClaudeClientIdMode = Pick<ClaudeSettings, 'useDefaultClientId' | 'clientId'>;

export function defaultClaudeSettings(): ClaudeSettings {
  return { useDefaultClientId: true, clientId: '', accounts: [], activeAccountId: null };
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function normalizeClientId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isUuid(trimmed) ? trimmed.toLowerCase() : null;
}

export function effectiveClaudeClientId(claude: ClaudeClientIdMode): string {
  if (claude.useDefaultClientId) return DEFAULT_CLAUDE_OAUTH_CLIENT_ID;
  return normalizeClientId(claude.clientId) ?? DEFAULT_CLAUDE_OAUTH_CLIENT_ID;
}

export function readClaudeClientIdMode(useDefault: unknown, rawClientId: unknown): ClaudeClientIdMode {
  const clientId = normalizeClientId(rawClientId);
  if (typeof useDefault === 'boolean') {
    if (!useDefault && clientId !== null) return { useDefaultClientId: false, clientId };
    return { useDefaultClientId: true, clientId: clientId ?? '' };
  }
  if (clientId === null || clientId === DEFAULT_CLAUDE_OAUTH_CLIENT_ID) return { useDefaultClientId: true, clientId: '' };
  return { useDefaultClientId: false, clientId };
}

export function isClaudeAccountId(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_ID.test(value);
}

export function cleanAccountName(value: string): string {
  return value.trim();
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function accountNameProblem(
  name: string,
  accounts: readonly ClaudeAccount[],
  exceptId: string | null = null,
): ClaudeAccountNameProblem | null {
  const cleaned = cleanAccountName(name);
  if (cleaned === '') return 'empty';
  if (cleaned.length > MAX_CLAUDE_ACCOUNT_NAME) return 'too-long';
  return accounts.some((account) => account.id !== exceptId && sameName(account.name, cleaned)) ? 'taken' : null;
}

export function activeClaudeAccount(settings: ClaudeSettings): ClaudeAccount | null {
  return settings.accounts.find((account) => account.id === settings.activeAccountId) ?? null;
}

export function normalizeActiveAccountId(accounts: readonly ClaudeAccount[], candidate: unknown): string | null {
  if (accounts.some((account) => account.id === candidate)) return candidate as string;
  return accounts[0]?.id ?? null;
}

function readAccount(raw: unknown): ClaudeAccount | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { id, name } = raw as Record<string, unknown>;
  if (!isClaudeAccountId(id) || typeof name !== 'string') return null;
  return { id, name: cleanAccountName(name) };
}

export function readClaudeAccounts(raw: unknown): ClaudeAccount[] | null {
  if (!Array.isArray(raw)) return null;
  const accounts: ClaudeAccount[] = [];
  for (const entry of raw) {
    const account = readAccount(entry);
    if (account === null || accounts.some((existing) => existing.id === account.id)) continue;
    if (accountNameProblem(account.name, accounts) !== null) continue;
    if (accounts.length < MAX_CLAUDE_ACCOUNTS) accounts.push(account);
  }
  return accounts;
}

export function readStrictClaudeAccounts(raw: unknown): ClaudeAccount[] | null {
  const accounts = readClaudeAccounts(raw);
  return accounts !== null && accounts.length === (raw as unknown[]).length ? accounts : null;
}

export function readClaudeSettings(raw: unknown): ClaudeSettings {
  const defaults = defaultClaudeSettings();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaults;
  const source = raw as Record<string, unknown>;
  const accounts = readClaudeAccounts(source['accounts']) ?? [];
  return {
    ...readClaudeClientIdMode(source['useDefaultClientId'], source['clientId']),
    accounts,
    activeAccountId: normalizeActiveAccountId(accounts, source['activeAccountId']),
  };
}
