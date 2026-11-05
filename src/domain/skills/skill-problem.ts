import { FIX_LABELS } from '../connections';

export type RunProblem = 'claude-code-missing' | 'mcp-unauthenticated';
export type RunFix = 'install-claude-code' | 'reconnect-mcp';

export const RUN_FIX_FOR: Record<RunProblem, RunFix> = {
  'claude-code-missing': 'install-claude-code',
  'mcp-unauthenticated': 'reconnect-mcp',
};

export const RUN_FIX_LABELS: Record<RunFix, string> = {
  'install-claude-code': FIX_LABELS['install-claude-code'],
  'reconnect-mcp': 'Reconectar MCP',
};

export const RUN_PROBLEM_MESSAGES: Record<RunProblem, string> = {
  'claude-code-missing': 'Claude Code não encontrado.',
  'mcp-unauthenticated': 'Um servidor MCP precisa de autenticação.',
};

export function mcpProblemMessage(servers: readonly string[]): string {
  return servers.length === 0
    ? RUN_PROBLEM_MESSAGES['mcp-unauthenticated']
    : `MCP sem autenticação: ${servers.join(', ')}.`;
}
