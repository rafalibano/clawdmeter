import { ConnectionProblemError, errorStatus, type ConnectionStatus, type FixAction } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { SystemSettings } from '../../../ports';

export class FixNotifications implements StatusUseCase<FixAction> {
  constructor(
    private readonly check: StatusUseCase,
    private readonly settings: SystemSettings,
  ) {}

  async execute(fix: FixAction): Promise<ConnectionStatus> {
    switch (fix) {
      case 'retry':
        return this.check.execute();
      case 'open-system-settings': {
        const before = await this.check.execute();
        await this.settings.openNotifications();
        return errorStatus(
          before.state === 'error' ? before.problem : 'notifications-blocked',
          'Libere as notificações e clique em "Verificar de novo".',
        );
      }
      default:
        throw new ConnectionProblemError('unexpected', `Conserto não se aplica às notificações: ${fix}`);
    }
  }
}
