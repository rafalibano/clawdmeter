export type RunProblem = 'claude-code-missing' | 'mcp-unauthenticated';
export type RunFix = 'install-claude-code' | 'reconnect-mcp';

export const RUN_FIX_FOR: Record<RunProblem, RunFix> = {
  'claude-code-missing': 'install-claude-code',
  'mcp-unauthenticated': 'reconnect-mcp',
};
