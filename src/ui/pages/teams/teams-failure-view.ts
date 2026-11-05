import type { PageUpdate } from '../../../application/scheduler';
import { actionsForProblem, type ConnectionAction } from '../../../domain/connections';
import type { I18n } from '../../i18n';

export interface FailureView {
  message: string;
  actions: ConnectionAction[];
}

export const RETRY_ACTION: ConnectionAction = { kind: 'recheck', label: 'retry' };

export function toFailureView(update: PageUpdate | undefined, i18n: Pick<I18n, 'errorText'>): FailureView | null {
  if (update?.status !== 'error') return null;
  const actions = update.problem ? actionsForProblem('microsoft', update.problem) : [];
  return { message: i18n.errorText(update), actions: actions.length > 0 ? actions : [RETRY_ACTION] };
}
