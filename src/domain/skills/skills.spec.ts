import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SKILLS,
  buildClaudeArgs,
  parseSkillsConfig,
  type SkillDefinition,
} from './skill-definition';
import { RUN_FIX_FOR, RUN_FIX_LABELS, RUN_PROBLEM_MESSAGES, mcpProblemMessage, type RunProblem } from './skill-problem';
import {
  MAX_LOG_ENTRIES,
  MAX_RUN_HISTORY,
  applyStreamEvent,
  finishRun,
  isResumableSession,
  parseRunHistory,
  runDurationMs,
  runProblemMessage,
  startRun,
  toStoredRun,
  trimHistory,
  type SkillRun,
} from './skill-run';
import {
  BUDGET_EXCEEDED_STREAM,
  FIXTURE_SESSION_ID,
  MCP_NEEDS_AUTH_STREAM,
  NOISY_STREAM,
  SUCCESS_STREAM,
} from './stream-fixtures';
import { parseStreamLine, type StreamEvent } from './stream-json';

const SKILL: SkillDefinition = { ...DEFAULT_SKILLS[0]!, id: 'demo', name: 'Demo', prompt: '/demo', maxBudgetUsd: 1.5 };

function replay(lines: readonly string[]): SkillRun {
  let run = startRun('r1', SKILL, 1_000);
  for (const line of lines) {
    const event = parseStreamLine(line);
    if (event) run = applyStreamEvent(run, event);
  }
  return run;
}

describe('parseStreamLine', () => {
  it('lê init com sessão e servidores MCP', () => {
    expect(parseStreamLine(SUCCESS_STREAM[0]!)).toEqual({
      type: 'init',
      sessionId: FIXTURE_SESSION_ID,
      mcpServers: [{ name: 'atlassian', status: 'connected' }],
    });
  });

  it('lê blocos de texto e de ferramenta do assistant', () => {
    expect(parseStreamLine(SUCCESS_STREAM[1]!)).toMatchObject({ type: 'assistant', blocks: [{ kind: 'text', text: 'Vou listar os PRs abertos.' }] });
    expect(parseStreamLine(SUCCESS_STREAM[2]!)).toMatchObject({ type: 'assistant', blocks: [{ kind: 'tool', name: 'Bash' }] });
  });

  it('lê o resultado com custo, duração e sessão', () => {
    expect(parseStreamLine(SUCCESS_STREAM[5]!)).toEqual({
      type: 'result',
      sessionId: FIXTURE_SESSION_ID,
      isError: false,
      subtype: 'success',
      text: '## Acabativa\n\n- acme/api#12 aguardando review',
      costUsd: 0.1234,
      durationMs: 42_000,
    });
  });

  it('trata subtype diferente de success como erro', () => {
    expect(parseStreamLine(BUDGET_EXCEEDED_STREAM[2]!)).toMatchObject({ isError: true, subtype: 'error_max_budget_usd', text: null });
  });

  it('ignora linhas vazias, texto solto e JSON quebrado', () => {
    const events: Array<StreamEvent | null> = NOISY_STREAM.map(parseStreamLine);
    expect(events.filter((event) => event !== null && event.type !== 'other')).toHaveLength(1);
    expect(events[0]).toBeNull();
    expect(events[1]).toBeNull();
    expect(events[2]).toEqual({ type: 'other' });
    expect(events[3]).toBeNull();
    expect(events[4]).toBeNull();
  });

  it('descarta blocos de texto em branco e tool_result do usuário', () => {
    expect(parseStreamLine('{"type":"assistant","message":{"content":[{"type":"text","text":"  "}]}}')).toMatchObject({ blocks: [] });
    expect(parseStreamLine(SUCCESS_STREAM[3]!)).toEqual({ type: 'other' });
  });
});

describe('applyStreamEvent', () => {
  it('acumula log, sessão, custo e resultado numa execução bem-sucedida', () => {
    const run = replay(SUCCESS_STREAM);
    expect(run).toMatchObject({
      status: 'succeeded',
      sessionId: FIXTURE_SESSION_ID,
      costUsd: 0.1234,
      error: null,
      problem: null,
      mcpNeedingAuth: [],
    });
    expect(run.log.map((entry) => entry.kind)).toEqual(['text', 'tool', 'text']);
    expect(run.resultText).toContain('Acabativa');
  });

  it('detecta MCP sem autenticação no init e marca o problema', () => {
    const run = replay(MCP_NEEDS_AUTH_STREAM);
    expect(run).toMatchObject({ status: 'failed', problem: 'mcp-unauthenticated', mcpNeedingAuth: ['atlassian'] });
    expect(runProblemMessage(run)).toBe('MCP sem autenticação: atlassian.');
  });

  it('erro de orçamento falha com o subtype quando não há texto', () => {
    expect(replay(BUDGET_EXCEEDED_STREAM)).toMatchObject({ status: 'failed', error: 'error_max_budget_usd', costUsd: 2.01 });
  });

  it('limita o log às últimas entradas', () => {
    let run = startRun('r', SKILL, 0);
    for (let index = 0; index < MAX_LOG_ENTRIES + 5; index += 1) {
      run = applyStreamEvent(run, { type: 'assistant', sessionId: null, blocks: [{ kind: 'text', text: `m${index}` }] });
    }
    expect(run.log).toHaveLength(MAX_LOG_ENTRIES);
    expect(run.log.at(-1)?.text).toBe(`m${MAX_LOG_ENTRIES + 4}`);
  });
});

describe('finishRun', () => {
  const running = startRun('r', SKILL, 1_000);

  it('cancelamento prevalece', () => {
    expect(finishRun(running, { code: null, cancelled: true, stderrTail: '', now: 2_000 })).toMatchObject({
      status: 'cancelled',
      endedAt: 2_000,
    });
  });

  it('saída sem resultado vira falha com o stderr', () => {
    expect(finishRun(running, { code: 1, cancelled: false, stderrTail: 'boom\n', now: 2_000 })).toMatchObject({
      status: 'failed',
      error: 'boom',
    });
    expect(finishRun(running, { code: 2, cancelled: false, stderrTail: '', now: 2_000 }).error).toContain('código 2');
  });

  it('mantém o status definido pelo resultado', () => {
    const done = replay(SUCCESS_STREAM);
    expect(finishRun(done, { code: 0, cancelled: false, stderrTail: '', now: 9_000 })).toMatchObject({
      status: 'succeeded',
      endedAt: 9_000,
    });
  });

  it('calcula a duração', () => {
    expect(runDurationMs({ ...running, endedAt: 4_000 }, 99_000)).toBe(3_000);
    expect(runDurationMs(running, 6_000)).toBe(5_000);
  });
});

describe('histórico', () => {
  it('guarda só as últimas runs, mais recentes primeiro', () => {
    const runs = Array.from({ length: MAX_RUN_HISTORY + 3 }, (_, index) => ({ ...startRun(`r${index}`, SKILL, index), status: 'succeeded' as const }));
    const trimmed = trimHistory(runs);
    expect(trimmed).toHaveLength(MAX_RUN_HISTORY);
    expect(trimmed[0]?.id).toBe(`r${MAX_RUN_HISTORY + 2}`);
  });

  it('serializa sem o log e relê com validação', () => {
    const run = { ...replay(SUCCESS_STREAM), endedAt: 5_000 };
    const stored = toStoredRun(run);
    expect(stored.log).toEqual([]);
    const parsed = parseRunHistory(JSON.parse(JSON.stringify({ runs: [stored, { id: 1 }, null, { ...stored, id: 'x', status: 'running' }] })));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'r1', costUsd: 0.1234, sessionId: FIXTURE_SESSION_ID });
  });

  it('arquivo inválido vira histórico vazio', () => {
    expect(parseRunHistory(null)).toEqual([]);
    expect(parseRunHistory({ runs: 'x' })).toEqual([]);
  });

  it('só aceita session id em formato de UUID', () => {
    expect(isResumableSession(FIXTURE_SESSION_ID)).toBe(true);
    expect(isResumableSession('abc; rm -rf /')).toBe(false);
    expect(isResumableSession(null)).toBe(false);
  });
});

describe('configuração de skills', () => {
  it('usa os padrões sem arquivo ou sem lista', () => {
    expect(parseSkillsConfig(null)[0]).toMatchObject({ id: 'acabativa', prompt: '/acabativa' });
    expect(parseSkillsConfig({ skills: 'x' })).toHaveLength(1);
  });

  it('lê skills válidas e aplica padrões de orçamento e ferramentas', () => {
    const [skill] = parseSkillsConfig({ skills: [{ id: 'prs', name: 'PRs', prompt: '/prs' }] });
    expect(skill).toMatchObject({ id: 'prs', maxBudgetUsd: 2, cwd: null });
    expect(skill?.allowedTools.length).toBeGreaterThan(0);
  });

  it('descarta entradas inválidas e ids repetidos', () => {
    const skills = parseSkillsConfig({
      skills: [
        { id: 'ok', name: 'Ok', prompt: '/ok', maxBudgetUsd: 3, allowedTools: ['Read'] },
        { id: 'ok', name: 'Repetida', prompt: '/ok' },
        { id: 'sem prompt', name: 'x', prompt: '/x' },
        { id: 'flag', name: 'Flag', prompt: '--dangerously-skip-permissions' },
        { id: 'budget', name: 'B', prompt: '/b', maxBudgetUsd: 0 },
        { id: 'tools', name: 'T', prompt: '/t', allowedTools: [1] },
        'texto',
      ],
    });
    expect(skills.map((skill) => skill.id)).toEqual(['ok']);
    expect(skills[0]).toMatchObject({ maxBudgetUsd: 3, allowedTools: ['Read'] });
  });

  it('rejeita ferramentas que o Rust barraria', () => {
    const accepted = (allowedTools: unknown[]) =>
      parseSkillsConfig({ skills: [{ id: 'x', name: 'X', prompt: '/x', allowedTools }] }).length === 1;
    expect(accepted(['Read', 'Bash(git diff:*)', 'mcp__srv__tool'])).toBe(true);
    expect(accepted(['--dangerously-skip-permissions'])).toBe(false);
    expect(accepted(['Read', '-x'])).toBe(false);
    expect(accepted(['Bash;rm'])).toBe(false);
    expect(accepted(['Bash$(x)'])).toBe(false);
    expect(accepted(['a,b'])).toBe(false);
    expect(accepted(['a\nb'])).toBe(false);
    expect(accepted(['  '])).toBe(false);
    expect(accepted(['x'.repeat(1_025)])).toBe(false);
  });

  it('monta os argumentos do claude sem shell, com stream-json e verbose', () => {
    expect(buildClaudeArgs({ ...SKILL, allowedTools: ['Read', 'Bash(git log:*)'] })).toEqual([
      '-p',
      '/demo',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-budget-usd',
      '1.5',
      '--allowedTools',
      'Read,Bash(git log:*)',
    ]);
    expect(buildClaudeArgs({ ...SKILL, allowedTools: [] })).not.toContain('--allowedTools');
  });
});

describe('problemas de run', () => {
  it('todo problema tem conserto com rótulo e mensagem', () => {
    const problems: RunProblem[] = ['claude-code-missing', 'mcp-unauthenticated'];
    for (const problem of problems) {
      expect(RUN_FIX_LABELS[RUN_FIX_FOR[problem]]).not.toBe('');
      expect(RUN_PROBLEM_MESSAGES[problem]).not.toBe('');
    }
    expect(RUN_FIX_LABELS['reconnect-mcp']).toBe('Reconectar MCP');
    expect(RUN_FIX_LABELS['install-claude-code']).toBe('Instalar Claude Code');
    expect(mcpProblemMessage([])).toBe(RUN_PROBLEM_MESSAGES['mcp-unauthenticated']);
  });
});
