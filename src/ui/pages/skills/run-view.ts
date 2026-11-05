import {
  RUN_FIX_FOR,
  formatDuration,
  isResumableSession,
  isRunning,
  runDurationMs,
  type RunFix,
  type RunLogEntry,
  type RunStatus,
  type SkillRun,
} from '../../../domain/skills';
import { describeRunFailure } from '../../../application/use-cases/skills';
import type { Localizer } from '../../i18n';

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

export { formatDuration };

function problemMessage(run: SkillRun, l: Localizer): string {
  if (run.problem === 'mcp-unauthenticated' && run.mcpNeedingAuth.length > 0) {
    return l.t('run.problem.mcp-servers', { servers: run.mcpNeedingAuth.join(', ') });
  }
  return l.t(`run.problem.${run.problem ?? 'claude-code-missing'}`);
}

export function toRunView(run: SkillRun, now: number, l: Localizer): RunView {
  const problem =
    run.problem === null
      ? null
      : {
          message: problemMessage(run, l),
          fix: RUN_FIX_FOR[run.problem],
          label: l.t(`action.${RUN_FIX_FOR[run.problem]}`),
        };
  const error = run.status === 'failed' ? describeRunFailure(run, l) : '';
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    statusLabel: l.t(`run.status.${run.status}`),
    running: isRunning(run),
    duration: formatDuration(runDurationMs(run, now)),
    cost: run.costUsd === null ? null : l.cost(run.costUsd),
    recentLog: run.log.slice(-VISIBLE_LOG_ENTRIES),
    resultText: run.resultText,
    error: error === '' ? null : error,
    problem,
    canContinue: !isRunning(run) && isResumableSession(run.sessionId),
  };
}
