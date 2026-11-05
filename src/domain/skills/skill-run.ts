import { mcpProblemMessage, type RunProblem } from './skill-problem';
import type { SkillDefinition } from './skill-definition';
import type { StreamEvent } from './stream-json';

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RunLogEntry {
  kind: 'text' | 'tool';
  text: string;
}

export interface SkillRun {
  id: string;
  skillId: string;
  name: string;
  prompt: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  costUsd: number | null;
  sessionId: string | null;
  cwd: string | null;
  resultText: string | null;
  error: string | null;
  problem: RunProblem | null;
  mcpNeedingAuth: string[];
  log: RunLogEntry[];
}

export const MAX_LOG_ENTRIES = 80;
export const MAX_RUN_HISTORY = 20;
export const NEEDS_AUTH_STATUS = 'needs-auth';
export const MCP_PROBLEM_STATUSES: readonly string[] = [NEEDS_AUTH_STATUS, 'pending', 'failed'];

export const TRUNCATED_STREAM_ERROR = 'Saída truncada: um evento do Claude passou de 4 MiB e foi cortado.';

const SESSION_ID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function isRunning(run: SkillRun): boolean {
  return run.endedAt === null;
}

export function isResumableSession(sessionId: string | null): sessionId is string {
  return sessionId !== null && SESSION_ID_PATTERN.test(sessionId);
}

export function startRun(id: string, skill: SkillDefinition, now: number): SkillRun {
  return {
    id,
    skillId: skill.id,
    name: skill.name,
    prompt: skill.prompt,
    status: 'running',
    startedAt: now,
    endedAt: null,
    costUsd: null,
    sessionId: null,
    cwd: skill.cwd,
    resultText: null,
    error: null,
    problem: null,
    mcpNeedingAuth: [],
    log: [],
  };
}

function appendLog(log: RunLogEntry[], entries: RunLogEntry[]): RunLogEntry[] {
  return [...log, ...entries].slice(-MAX_LOG_ENTRIES);
}

export function applyStreamEvent(run: SkillRun, event: StreamEvent): SkillRun {
  switch (event.type) {
    case 'init': {
      const needingAuth = event.mcpServers.filter((server) => MCP_PROBLEM_STATUSES.includes(server.status)).map((server) => server.name);
      return {
        ...run,
        sessionId: event.sessionId ?? run.sessionId,
        mcpNeedingAuth: needingAuth,
        problem: needingAuth.length > 0 ? 'mcp-unauthenticated' : run.problem,
      };
    }
    case 'assistant':
      return {
        ...run,
        sessionId: event.sessionId ?? run.sessionId,
        log: appendLog(
          run.log,
          event.blocks.map((block) =>
            block.kind === 'text' ? { kind: 'text', text: block.text } : { kind: 'tool', text: block.name },
          ),
        ),
      };
    case 'result':
      return {
        ...run,
        sessionId: event.sessionId ?? run.sessionId,
        costUsd: event.costUsd ?? run.costUsd,
        resultText: event.text ?? run.resultText,
        status: event.isError ? 'failed' : 'succeeded',
        error: event.isError ? (event.text ?? event.subtype ?? 'A execução falhou.') : null,
      };
    case 'truncated':
      return { ...run, error: TRUNCATED_STREAM_ERROR };
    case 'other':
      return run;
  }
}

export interface RunExit {
  code: number | null;
  cancelled: boolean;
  stderrTail: string;
  now: number;
}

export function finishRun(run: SkillRun, exit: RunExit): SkillRun {
  const finished: SkillRun = { ...run, endedAt: exit.now };
  if (exit.cancelled) return { ...finished, status: 'cancelled', error: null };
  if (run.status !== 'running') return finished;
  const detail = [run.error ?? '', exit.stderrTail.trim()].filter((part) => part !== '').join('\n');
  return {
    ...finished,
    status: 'failed',
    error: detail !== '' ? detail : `O Claude Code encerrou sem resultado (código ${exit.code ?? 'desconhecido'}).`,
  };
}

export function runProblemMessage(run: SkillRun): string | null {
  return run.problem === 'mcp-unauthenticated' ? mcpProblemMessage(run.mcpNeedingAuth) : null;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatCost(costUsd: number | null): string | null {
  return costUsd === null ? null : `US$ ${costUsd.toFixed(2)}`;
}

export interface RunNotice {
  title: string;
  body: string;
}

const NOTICE_ERROR_CHARS = 140;

export function runNotice(run: SkillRun): RunNotice | null {
  if (isRunning(run) || run.status === 'cancelled') return null;
  const details = [formatCost(run.costUsd), formatDuration(runDurationMs(run, run.endedAt ?? run.startedAt))].filter(
    (part): part is string => part !== null,
  );
  if (run.status === 'succeeded') return { title: `${run.name} concluída`, body: details.join(' · ') };
  const reason = (run.error ?? '').trim().replace(/\s+/g, ' ').slice(0, NOTICE_ERROR_CHARS);
  return { title: `${run.name} falhou`, body: [reason, ...details].filter((part) => part !== '').join(' · ') };
}

export function runDurationMs(run: SkillRun, now: number): number {
  return Math.max(0, (run.endedAt ?? now) - run.startedAt);
}

export function trimHistory(runs: readonly SkillRun[]): SkillRun[] {
  return [...runs].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_RUN_HISTORY);
}

export function toStoredRun(run: SkillRun): SkillRun {
  return { ...run, log: [] };
}

const STATUSES: readonly string[] = ['succeeded', 'failed', 'cancelled'];
const PROBLEMS: readonly string[] = ['claude-code-missing', 'mcp-unauthenticated'];

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseStoredRun(raw: unknown): SkillRun | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const { id, skillId, name, prompt, status, startedAt, endedAt, costUsd, problem, mcpNeedingAuth } = source;
  if (typeof id !== 'string' || typeof skillId !== 'string' || typeof name !== 'string') return null;
  if (typeof prompt !== 'string' || typeof startedAt !== 'number') return null;
  if (typeof status !== 'string' || !STATUSES.includes(status)) return null;
  return {
    id,
    skillId,
    name,
    prompt,
    status: status as RunStatus,
    startedAt,
    endedAt: typeof endedAt === 'number' ? endedAt : startedAt,
    costUsd: typeof costUsd === 'number' ? costUsd : null,
    sessionId: optionalString(source['sessionId']),
    cwd: optionalString(source['cwd']),
    resultText: optionalString(source['resultText']),
    error: optionalString(source['error']),
    problem: typeof problem === 'string' && PROBLEMS.includes(problem) ? (problem as RunProblem) : null,
    mcpNeedingAuth: Array.isArray(mcpNeedingAuth) ? mcpNeedingAuth.filter((name) => typeof name === 'string') : [],
    log: [],
  };
}

export function parseRunHistory(raw: unknown): SkillRun[] {
  const list = (raw as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(list)) return [];
  return trimHistory(list.flatMap((entry) => parseStoredRun(entry) ?? []));
}
