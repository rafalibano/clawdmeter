import { ConnectionProblemError, type ConnectionStatus, type FixAction } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';

export class FixMicrosoftConnection implements StatusUseCase<FixAction> {
  constructor(
    private readonly check: StatusUseCase,
    private readonly connect: StatusUseCase,
  ) {}

  execute(fix: FixAction): Promise<ConnectionStatus> {
    switch (fix) {
      case 'retry-permission':
      case 'use-github-cli':
      case 'retry':
        return this.check.execute();
      case 'relogin-microsoft':
      case 'connect-microsoft':
        return this.connect.execute();
      default:
        throw new ConnectionProblemError('unexpected', `Fix does not apply to Microsoft: ${fix}`);
    }
  }
}
