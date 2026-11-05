import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILLS, FIXTURE_SESSION_ID, startRun, type SkillRun } from '../../../domain/skills';
import { formatCost, formatDuration, toRunView } from './run-view';

const RUNNING = startRun('r1', DEFAULT_SKILLS[0]!, 1_000);

describe('formatDuration', () => {
  it('formata segundos e minutos', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59_999)).toBe('59s');
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(600_000)).toBe('10m 00s');
  });
});

describe('formatCost', () => {
  it('usa duas casas e trata ausência', () => {
    expect(formatCost(0.1234)).toBe('US$ 0.12');
    expect(formatCost(null)).toBeNull();
  });
});

describe('toRunView', () => {
  it('run em andamento mostra tempo corrido e as últimas linhas do log', () => {
    const run: SkillRun = {
      ...RUNNING,
      log: Array.from({ length: 8 }, (_, index) => ({ kind: 'text' as const, text: `m${index}` })),
    };
    const view = toRunView(run, 6_000);
    expect(view).toMatchObject({ running: true, statusLabel: 'Rodando…', duration: '5s', canContinue: false });
    expect(view.recentLog.map((entry) => entry.text)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7']);
  });

  it('run concluída mostra custo, resultado e permite continuar no terminal', () => {
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
      cost: 'US$ 0.50',
      resultText: '# ok',
      canContinue: true,
      error: null,
    });
  });

  it('falha mostra o erro; problema de MCP traz mensagem e botão Reconectar MCP', () => {
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

  it('Claude Code ausente traz o botão Instalar Claude Code', () => {
    const run: SkillRun = { ...RUNNING, status: 'failed', endedAt: 1_100, error: 'x', problem: 'claude-code-missing' };
    expect(toRunView(run, 2_000).problem).toEqual({
      message: 'Claude Code não encontrado.',
      fix: 'install-claude-code',
      label: 'Instalar Claude Code',
    });
  });

  it('session id inválido não permite continuar', () => {
    expect(toRunView({ ...RUNNING, status: 'succeeded', sessionId: 'abc' }, 2_000).canContinue).toBe(false);
  });
});
