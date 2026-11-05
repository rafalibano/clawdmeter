import type { PageUpdate } from '../../../application/scheduler';
import { actionsForProblem, type ConnectionAction } from '../../../domain/connections';

export interface FailureView {
  message: string;
  actions: ConnectionAction[];
}

export const RETRY_ACTION: ConnectionAction = { kind: 'recheck', label: 'Tentar de novo' };

export function toFailureView(update: PageUpdate | undefined): FailureView | null {
  if (update?.status !== 'error') return null;
  const actions = update.problem ? actionsForProblem('microsoft', update.problem) : [];
  return { message: update.error, actions: actions.length > 0 ? actions : [RETRY_ACTION] };
}
