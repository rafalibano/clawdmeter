import { ConnectionProblemError, type ConnectionStatus, type FixAction } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';

export class FixClaudeConnection implements StatusUseCase<FixAction> {
  constructor(private readonly check: StatusUseCase) {}

  execute(fix: FixAction): Promise<ConnectionStatus> {
    switch (fix) {
      case 'retry':
      case 'add-claude-account':
      case 'reauthenticate-claude':
        return this.check.execute();
      default:
        throw new ConnectionProblemError('unexpected', `Fix does not apply to Claude: ${fix}`);
    }
  }
}
