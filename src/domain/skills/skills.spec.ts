import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CLAUDE_TOOLS,
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_SKILLS,
  buildClaudeArgs,
  findDisallowedTools,
  parseSkillsConfig,
  type SkillDefinition,
} from './skill-definition';
import { RUN_FIX_FOR, type RunProblem } from './skill-problem';
import {
  MAX_LOG_ENTRIES,
  MAX_RUN_HISTORY,
  applyStreamEvent,
  finishRun,
  isResumableSession,
  parseRunHistory,
  runDurationMs,
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
  it('reads init with session and MCP servers', () => {
    expect(parseStreamLine(SUCCESS_STREAM[0]!)).toEqual({
      type: 'init',
      sessionId: FIXTURE_SESSION_ID,
      mcpServers: [{ name: 'atlassian', status: 'connected' }],
    });
  });

  it('reads text and tool blocks from the assistant', () => {
    expect(parseStreamLine(SUCCESS_STREAM[1]!)).toMatchObject({ type: 'assistant', blocks: [{ kind: 'text', text: 'Vou listar os PRs abertos.' }] });
    expect(parseStreamLine(SUCCESS_STREAM[2]!)).toMatchObject({ type: 'assistant', blocks: [{ kind: 'tool', name: 'Bash' }] });
  });

  it('reads the result with cost, duration and session', () => {
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

  it('treats a subtype other than success as an error', () => {
    expect(parseStreamLine(BUDGET_EXCEEDED_STREAM[2]!)).toMatchObject({ isError: true, subtype: 'error_max_budget_usd', text: null });
  });

  it('ignores empty lines, loose text and broken JSON', () => {
    const events: Array<StreamEvent | null> = NOISY_STREAM.map(parseStreamLine);
    expect(events.filter((event) => event !== null && event.type !== 'other')).toHaveLength(1);
    expect(events[0]).toBeNull();
    expect(events[1]).toBeNull();
    expect(events[2]).toEqual({ type: 'other' });
    expect(events[3]).toBeNull();
    expect(events[4]).toBeNull();
  });

  it('drops blank text blocks and user tool_result', () => {
    expect(parseStreamLine('{"type":"assistant","message":{"content":[{"type":"text","text":"  "}]}}')).toMatchObject({ blocks: [] });
    expect(parseStreamLine(SUCCESS_STREAM[3]!)).toEqual({ type: 'other' });
  });
});

describe('applyStreamEvent', () => {
  it('accumulates log, session, cost and result in a successful run', () => {
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

  it('detects an unauthenticated MCP at init and flags the problem', () => {
    const run = replay(MCP_NEEDS_AUTH_STREAM);
    expect(run).toMatchObject({ status: 'failed', problem: 'mcp-unauthenticated', mcpNeedingAuth: ['atlassian'] });
  });

  it('MCP pending or failed at init also become a problem; connected does not', () => {
    const init = (servers: Array<{ name: string; status: string }>) =>
      applyStreamEvent(startRun('r', SKILL, 0), { type: 'init', sessionId: null, mcpServers: servers });
    const run = init([
      { name: 'a', status: 'pending' },
      { name: 'b', status: 'failed' },
      { name: 'c', status: 'connected' },
    ]);
    expect(run).toMatchObject({ problem: 'mcp-unauthenticated', mcpNeedingAuth: ['a', 'b'] });
    expect(init([{ name: 'c', status: 'connected' }]).problem).toBeNull();
  });

  it('budget error fails with the subtype when there is no text', () => {
    expect(replay(BUDGET_EXCEEDED_STREAM)).toMatchObject({ status: 'failed', error: 'error_max_budget_usd', costUsd: 2.01 });
  });

  it('limits the log to the latest entries', () => {
    let run = startRun('r', SKILL, 0);
    for (let index = 0; index < MAX_LOG_ENTRIES + 5; index += 1) {
      run = applyStreamEvent(run, { type: 'assistant', sessionId: null, blocks: [{ kind: 'text', text: `m${index}` }] });
    }
    expect(run.log).toHaveLength(MAX_LOG_ENTRIES);
    expect(run.log.at(-1)?.text).toBe(`m${MAX_LOG_ENTRIES + 4}`);
  });
});

describe('line truncated by Rust', () => {
  const MARK = ' …[line truncated]';
  const cut = (text: string) => `${text}${MARK}`;

  it('the parser recognizes the marker and does not try to read cut JSON', () => {
    expect(parseStreamLine(cut('{"type":"result","result":"aaaa'))).toEqual({ type: 'truncated' });
    expect(parseStreamLine(cut('{"type":"assistant"'))).toEqual({ type: 'truncated' });
    expect(parseStreamLine('loose text …[line truncated]')).toBeNull();
  });

  it('a truncated result becomes a clear error instead of "exited without a result"', () => {
    let run = startRun('r', SKILL, 1_000);
    for (const line of [SUCCESS_STREAM[0]!, cut('{"type":"result","subtype":"success","result":"aaaa')]) {
      const event = parseStreamLine(line);
      if (event) run = applyStreamEvent(run, event);
    }
    const done = finishRun(run, { code: 0, cancelled: false, stderrTail: '', now: 2_000 });
    expect(done).toMatchObject({ status: 'failed', error: null, failure: 'truncated' });
  });

  it('a truncated result shows the marker and then the process stderr', () => {
    let run = startRun('r', SKILL, 1_000);
    for (const line of [SUCCESS_STREAM[0]!, cut('{"type":"result","subtype":"success","result":"aaaa')]) {
      const event = parseStreamLine(line);
      if (event) run = applyStreamEvent(run, event);
    }
    const done = finishRun(run, { code: 1, cancelled: false, stderrTail: 'Error: out of memory\n', now: 2_000 });
    expect(done.status).toBe('failed');
    expect(done).toMatchObject({ failure: 'truncated', error: 'Error: out of memory' });
  });

  it('an event truncated in the middle does not break a run that ends with a valid result', () => {
    const run = replay([SUCCESS_STREAM[0]!, cut('{"type":"assistant","message":{"content":[{"type":"text","text":"xx'), SUCCESS_STREAM[5]!]);
    expect(run).toMatchObject({ status: 'succeeded', error: null });
  });
});

describe('finishRun', () => {
  const running = startRun('r', SKILL, 1_000);

  it('cancellation prevails', () => {
    expect(finishRun(running, { code: null, cancelled: true, stderrTail: '', now: 2_000 })).toMatchObject({
      status: 'cancelled',
      endedAt: 2_000,
    });
  });

  it('output without a result becomes a failure with the stderr', () => {
    expect(finishRun(running, { code: 1, cancelled: false, stderrTail: 'boom\n', now: 2_000 })).toMatchObject({
      status: 'failed',
      error: 'boom',
    });
    expect(finishRun(running, { code: 2, cancelled: false, stderrTail: '', now: 2_000 })).toMatchObject({
      failure: 'no-result',
      exitCode: 2,
      error: null,
    });
  });

  it('a non-zero exit code without a result shows the whole stderr, trimmed', () => {
    const done = finishRun(running, { code: 137, cancelled: false, stderrTail: '\n  line 1\nline 2  \n', now: 2_000 });
    expect(done).toMatchObject({ status: 'failed', error: 'line 1\nline 2' });
  });

  it('with a result already set the stderr does not change the run error', () => {
    const failed = replay(BUDGET_EXCEEDED_STREAM);
    expect(finishRun(failed, { code: 1, cancelled: false, stderrTail: 'noise', now: 9_000 }).error).toBe('error_max_budget_usd');
  });

  it('keeps the status set by the result', () => {
    const done = replay(SUCCESS_STREAM);
    expect(finishRun(done, { code: 0, cancelled: false, stderrTail: '', now: 9_000 })).toMatchObject({
      status: 'succeeded',
      endedAt: 9_000,
    });
  });

  it('computes the duration', () => {
    expect(runDurationMs({ ...running, endedAt: 4_000 }, 99_000)).toBe(3_000);
    expect(runDurationMs(running, 6_000)).toBe(5_000);
  });
});

describe('history', () => {
  it('keeps only the latest runs, most recent first', () => {
    const runs = Array.from({ length: MAX_RUN_HISTORY + 3 }, (_, index) => ({ ...startRun(`r${index}`, SKILL, index), status: 'succeeded' as const }));
    const trimmed = trimHistory(runs);
    expect(trimmed).toHaveLength(MAX_RUN_HISTORY);
    expect(trimmed[0]?.id).toBe(`r${MAX_RUN_HISTORY + 2}`);
  });

  it('serializes without the log and reads back with validation', () => {
    const run = { ...replay(SUCCESS_STREAM), endedAt: 5_000 };
    const stored = toStoredRun(run);
    expect(stored.log).toEqual([]);
    const parsed = parseRunHistory(JSON.parse(JSON.stringify({ runs: [stored, { id: 1 }, null, { ...stored, id: 'x', status: 'running' }] })));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 'r1', costUsd: 0.1234, sessionId: FIXTURE_SESSION_ID });
  });

  it('an invalid file becomes an empty history', () => {
    expect(parseRunHistory(null)).toEqual([]);
    expect(parseRunHistory({ runs: 'x' })).toEqual([]);
  });

  it('only accepts a session id in UUID format', () => {
    expect(isResumableSession(FIXTURE_SESSION_ID)).toBe(true);
    expect(isResumableSession('abc; rm -rf /')).toBe(false);
    expect(isResumableSession(null)).toBe(false);
  });
});

describe('skills configuration', () => {
  it('uses the defaults without a file or without a list', () => {
    expect(parseSkillsConfig(null)[0]).toMatchObject({ id: 'acabativa', prompt: '/acabativa' });
    expect(parseSkillsConfig({ skills: 'x' })).toHaveLength(1);
  });

  it('reads valid skills and applies budget and tool defaults', () => {
    const [skill] = parseSkillsConfig({ skills: [{ id: 'prs', name: 'PRs', prompt: '/prs' }] });
    expect(skill).toMatchObject({ id: 'prs', maxBudgetUsd: 2, cwd: null });
    expect(skill?.allowedTools.length).toBeGreaterThan(0);
  });

  it('drops invalid entries and repeated ids', () => {
    const skills = parseSkillsConfig({
      skills: [
        { id: 'ok', name: 'Ok', prompt: '/ok', maxBudgetUsd: 3, allowedTools: ['Read'] },
        { id: 'ok', name: 'Repeated', prompt: '/ok' },
        { id: 'no prompt', name: 'x', prompt: '/x' },
        { id: 'flag', name: 'Flag', prompt: '--dangerously-skip-permissions' },
        { id: 'budget', name: 'B', prompt: '/b', maxBudgetUsd: 0 },
        { id: 'tools', name: 'T', prompt: '/t', allowedTools: [1] },
        'text',
      ],
    });
    expect(skills.map((skill) => skill.id)).toEqual(['ok']);
    expect(skills[0]).toMatchObject({ maxBudgetUsd: 3, allowedTools: ['Read'] });
  });

  it('budget follows the native process rules', () => {
    const accepted = (maxBudgetUsd: unknown) =>
      parseSkillsConfig({ skills: [{ id: 'x', name: 'X', prompt: '/x', maxBudgetUsd }] }).length === 1;
    expect(accepted(1000)).toBe(true);
    expect(accepted(0.5)).toBe(true);
    expect(accepted(1000.01)).toBe(false);
    expect(accepted(1e-7)).toBe(false);
    expect(accepted(0.1234567890123)).toBe(false);
    expect(accepted(-1)).toBe(false);
    expect(accepted(Number.POSITIVE_INFINITY)).toBe(false);
    expect(accepted('2')).toBe(false);
  });

  it('prompt has at most 8192 bytes', () => {
    const accepted = (prompt: string) => parseSkillsConfig({ skills: [{ id: 'x', name: 'X', prompt }] }).length === 1;
    expect(accepted('a'.repeat(8192))).toBe(true);
    expect(accepted('a'.repeat(8193))).toBe(false);
    expect(accepted('é'.repeat(4097))).toBe(false);
  });

  it('cwd must be an absolute path without ..', () => {
    const accepted = (cwd: unknown) =>
      parseSkillsConfig({ skills: [{ id: 'x', name: 'X', prompt: '/x', cwd }] }).length === 1;
    expect(accepted('/Users/dev/proj')).toBe(true);
    expect(accepted('C:\\Users\\dev')).toBe(true);
    expect(accepted(null)).toBe(true);
    expect(accepted('proj')).toBe(false);
    expect(accepted('~/proj')).toBe(false);
    expect(accepted('/Users/dev/../root')).toBe(false);
    expect(accepted('')).toBe(false);
    expect(accepted(3)).toBe(false);
  });

  it('rejects tools that Rust would block', () => {
    const accepted = (allowedTools: unknown[]) =>
      parseSkillsConfig({ skills: [{ id: 'x', name: 'X', prompt: '/x', allowedTools }] }).length === 1;
    expect(accepted(['Read(./**)', 'Bash(gh pr diff:*)'])).toBe(true);
    expect(accepted(['--dangerously-skip-permissions'])).toBe(false);
    expect(accepted(['Read', '-x'])).toBe(false);
    expect(accepted(['Bash;rm'])).toBe(false);
    expect(accepted(['Bash$(x)'])).toBe(false);
    expect(accepted(['a,b'])).toBe(false);
    expect(accepted(['a\nb'])).toBe(false);
    expect(accepted(['  '])).toBe(false);
    expect(accepted(['x'.repeat(1_025)])).toBe(false);
  });

  it('the allowed list is the same as Rust (process_policy.rs)', () => {
    const source = readFileSync(resolve(__dirname, '../../../src-tauri/src/commands/process_policy.rs'), 'utf8');
    const block = /ALLOWED_CLAUDE_TOOLS: &\[&str\] = &\[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const rust = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(rust.length).toBeGreaterThan(0);
    expect([...ALLOWED_CLAUDE_TOOLS]).toEqual(rust);
    expect(DEFAULT_ALLOWED_TOOLS.every((tool) => ALLOWED_CLAUDE_TOOLS.includes(tool))).toBe(true);
    expect(DEFAULT_ALLOWED_TOOLS.some((tool) => tool.startsWith('mcp__'))).toBe(false);
    expect(ALLOWED_CLAUDE_TOOLS.some((tool) => tool.startsWith('mcp__'))).toBe(false);
  });

  it('git diff, git log and git status are out of the list, and Read is restricted to the cwd', () => {
    for (const tool of ['Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git status:*)', 'Read', 'Grep', 'Glob']) {
      expect(ALLOWED_CLAUDE_TOOLS).not.toContain(tool);
      expect(findDisallowedTools([tool])).toEqual([tool]);
    }
    expect(ALLOWED_CLAUDE_TOOLS).toContain('Bash(gh pr diff:*)');
    expect(ALLOWED_CLAUDE_TOOLS).toContain('Read(./**)');
  });

  it('the default grants no broad Bash, writing or editing', () => {
    for (const tool of DEFAULT_ALLOWED_TOOLS) {
      expect(tool).not.toMatch(/^(Write|Edit|MultiEdit|NotebookEdit|Bash|Bash\(\*\)|Bash\((git|gh):\*\))$/);
    }
  });

  it('a tool outside the list invalidates the skill with a clear message', () => {
    for (const tool of ['Bash', 'Bash(*)', 'Read', 'Bash(git diff:*)', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash(git:*)', 'Bash(gh:*)', 'mcp__srv__tool', 'Grep', 'Glob']) {
      expect(findDisallowedTools(['Read(./**)', tool])).toEqual([tool]);
      expect(() => buildClaudeArgs({ ...SKILL, allowedTools: ['Read(./**)', tool] })).toThrow(
        `Skill "${SKILL.name}" uses a tool that is not allowed: ${tool}`,
      );
    }
    expect(findDisallowedTools(ALLOWED_CLAUDE_TOOLS)).toEqual([]);
  });

  it('builds the claude arguments without a shell, with stream-json and verbose', () => {
    expect(buildClaudeArgs({ ...SKILL, allowedTools: ['Read(./**)', 'Bash(gh pr diff:*)'] })).toEqual([
      '-p',
      '/demo',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-budget-usd',
      '1.5',
      '--allowedTools',
      'Read(./**),Bash(gh pr diff:*)',
    ]);
    expect(buildClaudeArgs({ ...SKILL, allowedTools: [] })).not.toContain('--allowedTools');
  });
});

describe('run problems', () => {
  it('every problem has a fix', () => {
    const problems: RunProblem[] = ['claude-code-missing', 'mcp-unauthenticated'];
    for (const problem of problems) expect(RUN_FIX_FOR[problem]).toBeDefined();
    expect(RUN_FIX_FOR['mcp-unauthenticated']).toBe('reconnect-mcp');
    expect(RUN_FIX_FOR['claude-code-missing']).toBe('install-claude-code');
  });
});
