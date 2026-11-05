import type { ConnectionStatus } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { NotificationPermission } from '../../../ports';
import { statusOfPermission } from './check-notifications';

export class ConnectNotifications implements StatusUseCase {
  constructor(private readonly permission: NotificationPermission) {}

  async execute(): Promise<ConnectionStatus> {
    return statusOfPermission(await this.permission.request());
  }
}
