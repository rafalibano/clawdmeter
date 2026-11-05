import { ConnectionProblemError, noteStatus, type ConnectionStatus, type FixAction } from '../../../../domain/connections';
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
        return noteStatus(before.state === 'error' ? before.problem : 'notifications-blocked', 'enable-notifications');
      }
      default:
        throw new ConnectionProblemError('unexpected', `Fix does not apply to notifications: ${fix}`);
    }
  }
}
