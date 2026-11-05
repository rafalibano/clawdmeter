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
      case 'retry':
        return this.check.execute();
      case 'relogin-microsoft':
        return this.connect.execute();
      default:
        throw new ConnectionProblemError('unexpected', `Conserto não se aplica à Microsoft: ${fix}`);
    }
  }
}
