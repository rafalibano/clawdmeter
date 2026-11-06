import type { ConnectionProblem } from './connection-problem';

export type FixAction =
  | 'add-claude-account'
  | 'reauthenticate-claude'
  | 'relogin-github'
  | 'connect-github-cli'
  | 'install-github-cli'
  | 'regrant-scopes'
  | 'authorize-org'
  | 'relogin-microsoft'
  | 'connect-microsoft'
  | 'open-system-settings'
  | 'open-org-page'
  | 'retry';

export const FIX_FOR: Record<ConnectionProblem, FixAction> = {
  'claude-no-account': 'add-claude-account',
  'claude-signin-required': 'reauthenticate-claude',
  'github-unauthorized': 'relogin-github',
  'github-missing-scope': 'regrant-scopes',
  'github-org-access': 'authorize-org',
  'microsoft-expired': 'relogin-microsoft',
  'microsoft-not-connected': 'connect-microsoft',
  'notifications-blocked': 'open-system-settings',
  'notifications-unverifiable': 'open-system-settings',
  'github-not-member': 'open-org-page',
  unexpected: 'retry',
};
