import {
  RUN_FIX_FOR,
  RUN_FIX_LABELS,
  RUN_PROBLEM_MESSAGES,
  isResumableSession,
  runDurationMs,
  runProblemMessage,
  type RunFix,
  type RunLogEntry,
  type RunStatus,
  type SkillRun,
} from '../../../domain/skills';

export const VISIBLE_LOG_ENTRIES = 5;

export interface RunProblemView {
  message: string;
  fix: RunFix;
  label: string;
}

export interface RunView {
  id: string;
  name: string;
  status: RunStatus;
  statusLabel: string;
  running: boolean;
  duration: string;
  cost: string | null;
  recentLog: RunLogEntry[];
  resultText: string | null;
  error: string | null;
  problem: RunProblemView | null;
  canContinue: boolean;
}

const STATUS_LABELS: Record<RunStatus, string> = {
  running: 'Rodando…',
  succeeded: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatCost(costUsd: number | null): string | null {
  return costUsd === null ? null : `US$ ${costUsd.toFixed(2)}`;
}

export function toRunView(run: SkillRun, now: number): RunView {
  const problem =
    run.problem === null
      ? null
      : {
          message: runProblemMessage(run) ?? RUN_PROBLEM_MESSAGES[run.problem],
          fix: RUN_FIX_FOR[run.problem],
          label: RUN_FIX_LABELS[RUN_FIX_FOR[run.problem]],
        };
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    statusLabel: STATUS_LABELS[run.status],
    running: run.status === 'running',
    duration: formatDuration(runDurationMs(run, now)),
    cost: formatCost(run.costUsd),
    recentLog: run.log.slice(-VISIBLE_LOG_ENTRIES),
    resultText: run.resultText,
    error: run.status === 'failed' ? run.error : null,
    problem,
    canContinue: run.status !== 'running' && isResumableSession(run.sessionId),
  };
}
