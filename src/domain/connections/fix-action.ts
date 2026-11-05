import type { ConnectionProblem } from './connection-problem';
import { GITHUB_ORG } from './github';

export type FixAction =
  | 'retry-permission'
  | 'relogin-claude'
  | 'install-claude-code'
  | 'relogin-github'
  | 'regrant-scopes'
  | 'authorize-org'
  | 'relogin-microsoft'
  | 'open-system-settings'
  | 'open-org-page'
  | 'retry';

export const FIX_FOR: Record<ConnectionProblem, FixAction> = {
  'keychain-denied': 'retry-permission',
  'claude-expired': 'relogin-claude',
  'claude-code-missing': 'install-claude-code',
  'github-unauthorized': 'relogin-github',
  'github-missing-scope': 'regrant-scopes',
  'github-org-access': 'authorize-org',
  'microsoft-expired': 'relogin-microsoft',
  'notifications-blocked': 'open-system-settings',
  'notifications-unverifiable': 'open-system-settings',
  'github-not-member': 'open-org-page',
  unexpected: 'retry',
};

export const FIX_LABELS: Record<FixAction, string> = {
  'retry-permission': 'Refazer permissão',
  'relogin-claude': 'Refazer login do Claude',
  'install-claude-code': 'Instalar Claude Code',
  'relogin-github': 'Refazer login do GitHub',
  'regrant-scopes': 'Refazer permissões',
  'authorize-org': 'Autorizar na org',
  'relogin-microsoft': 'Refazer login da Microsoft',
  'open-system-settings': 'Abrir ajustes do sistema',
  'open-org-page': 'Abrir página da org',
  retry: 'Tentar de novo',
};

export const PROBLEM_MESSAGES: Record<ConnectionProblem, string> = {
  'keychain-denied': 'Acesso ao cofre do sistema negado.',
  'claude-expired': 'Token vencido — abra o Claude Code para renová-lo ou refaça o login.',
  'claude-code-missing': 'Claude Code não encontrado.',
  'github-unauthorized': 'O token do GitHub é inválido ou foi revogado.',
  'github-missing-scope': 'O token do GitHub não tem os escopos necessários.',
  'github-org-access': 'Sem acesso à org Mottu-ops (SSO pendente).',
  'microsoft-expired': 'O login da Microsoft expirou.',
  'notifications-blocked': 'Notificações bloqueadas pelo sistema.',
  'notifications-unverifiable': 'Não foi possível verificar se as notificações estão liberadas. Confira nos ajustes do sistema.',
  'github-not-member': `Você não é membro da org ${GITHUB_ORG}.`,
  unexpected: 'Não foi possível verificar a conexão.',
};
