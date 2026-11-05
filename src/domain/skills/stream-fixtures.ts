export const FIXTURE_SESSION_ID = '3f2a9c1e-0000-4000-8000-123456789abc';

const line = (value: unknown): string => JSON.stringify(value);

const init = (mcpServers: { name: string; status: string }[]): string =>
  line({
    type: 'system',
    subtype: 'init',
    session_id: FIXTURE_SESSION_ID,
    model: 'claude-sonnet-4-5',
    tools: ['Read', 'Grep', 'Bash'],
    mcp_servers: mcpServers,
  });

const assistantText = (text: string): string =>
  line({ type: 'assistant', session_id: FIXTURE_SESSION_ID, message: { role: 'assistant', content: [{ type: 'text', text }] } });

const assistantTool = (name: string): string =>
  line({
    type: 'assistant',
    session_id: FIXTURE_SESSION_ID,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name, input: { command: 'gh pr list' } }] },
  });

const toolResult = (content: string): string =>
  line({
    type: 'user',
    session_id: FIXTURE_SESSION_ID,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content }] },
  });

const result = (overrides: Record<string, unknown>): string =>
  line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 42_000,
    total_cost_usd: 0.1234,
    session_id: FIXTURE_SESSION_ID,
    result: 'Tudo certo.',
    ...overrides,
  });

export const SUCCESS_STREAM: readonly string[] = [
  init([{ name: 'atlassian', status: 'connected' }]),
  assistantText('Vou listar os PRs abertos.'),
  assistantTool('Bash'),
  toolResult('acme/api#12 feat: nova rota'),
  assistantText('Encontrei 1 PR aberto em acme/api.'),
  result({ result: '## Acabativa\n\n- acme/api#12 aguardando review' }),
];

export const MCP_NEEDS_AUTH_STREAM: readonly string[] = [
  init([
    { name: 'atlassian', status: 'needs-auth' },
    { name: 'github', status: 'connected' },
  ]),
  assistantText('I could not access Jira.'),
  result({ is_error: true, subtype: 'error_during_execution', result: 'MCP server atlassian is not authenticated.', total_cost_usd: 0.01 }),
];

export const BUDGET_EXCEEDED_STREAM: readonly string[] = [
  init([]),
  assistantText('Analisando…'),
  result({ is_error: true, subtype: 'error_max_budget_usd', result: null, total_cost_usd: 2.01 }),
];

export const NOISY_STREAM: readonly string[] = [
  '',
  'warning: not json',
  '{"type": "system", "subtype": "hook_started"}',
  '{truncated',
  '[1,2,3]',
  assistantText('ok'),
];
