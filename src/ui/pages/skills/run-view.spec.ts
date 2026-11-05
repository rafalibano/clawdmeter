import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILLS, FIXTURE_SESSION_ID, startRun, type SkillRun } from '../../../domain/skills';
import { Localizer } from '../../i18n';
import { formatDuration, toRunView as toRunViewWith } from './run-view';

const PT = new Localizer('pt-BR');
const EN = new Localizer('en');
const toRunView = (run: SkillRun, now: number) => toRunViewWith(run, now, PT);

const RUNNING = startRun('r1', DEFAULT_SKILLS[0]!, 1_000);

describe('formatDuration', () => {
  it('formats seconds and minutes', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59_999)).toBe('59s');
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(600_000)).toBe('10m 00s');
  });
});

describe('cost by language', () => {
  it('uses two decimals, comma in pt-BR and dot in en', () => {
    expect(PT.cost(0.1234)).toBe('US$ 0,12');
    expect(EN.cost(0.1234)).toBe('US$ 0.12');
  });

  it('the view follows the language of the label and of the cost', () => {
    const run: SkillRun = { ...RUNNING, status: 'succeeded', endedAt: 5_000, costUsd: 0.5 };
    expect(toRunViewWith(run, 6_000, EN)).toMatchObject({ statusLabel: 'Completed', cost: 'US$ 0.50' });
    expect(toRunView(run, 6_000)).toMatchObject({ statusLabel: 'Concluída', cost: 'US$ 0,50' });
  });
});

describe('toRunView', () => {
  it('a run in progress shows elapsed time and the last log lines', () => {
    const run: SkillRun = {
      ...RUNNING,
      log: Array.from({ length: 8 }, (_, index) => ({ kind: 'text' as const, text: `m${index}` })),
    };
    const view = toRunView(run, 6_000);
    expect(view).toMatchObject({ running: true, statusLabel: 'Rodando…', duration: '5s', canContinue: false });
    expect(view.recentLog.map((entry) => entry.text)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']);
  });

  it('a finished run shows cost, result and allows continuing in the terminal', () => {
    const run: SkillRun = {
      ...RUNNING,
      status: 'succeeded',
      endedAt: 66_000,
      costUsd: 0.5,
      sessionId: FIXTURE_SESSION_ID,
      resultText: '# ok',
    };
    expect(toRunView(run, 99_000)).toMatchObject({
      statusLabel: 'Concluída',
      duration: '1m 05s',
      cost: 'US$ 0,50',
      resultText: '# ok',
      canContinue: true,
      error: null,
    });
  });

  it('failure shows the error; an MCP problem brings a message and a Reconnect MCP button', () => {
    const run: SkillRun = {
      ...RUNNING,
      status: 'failed',
      endedAt: 2_000,
      error: 'sem auth',
      problem: 'mcp-unauthenticated',
      mcpNeedingAuth: ['atlassian'],
    };
    expect(toRunView(run, 3_000)).toMatchObject({
      error: 'sem auth',
      problem: { message: 'MCP com problema: atlassian.', fix: 'reconnect-mcp', label: 'Reconectar MCP' },
      canContinue: false,
    });
  });

  it('missing Claude Code brings the Install Claude Code button', () => {
    const run: SkillRun = { ...RUNNING, status: 'failed', endedAt: 1_100, error: 'x', problem: 'claude-code-missing' };
    expect(toRunView(run, 2_000).problem).toEqual({
      message: 'Claude Code não encontrado.',
      fix: 'install-claude-code',
      label: 'Instalar Claude Code',
    });
  });

  it('an invalid session id does not allow continuing', () => {
    expect(toRunView({ ...RUNNING, status: 'succeeded', sessionId: 'abc' }, 2_000).canContinue).toBe(false);
  });
});
