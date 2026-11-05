import { errorStatus, type ConnectionStatus } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { NotificationPermission, NotificationPermissionState } from '../../../ports';

export function statusOfPermission(state: NotificationPermissionState): ConnectionStatus {
  if (state === 'granted') return { state: 'connected' };
  if (state === 'denied') return errorStatus('notifications-blocked');
  return { state: 'disconnected' };
}

export class CheckNotifications implements StatusUseCase {
  constructor(private readonly permission: NotificationPermission) {}

  async execute(): Promise<ConnectionStatus> {
    return statusOfPermission(await this.permission.status());
  }
}
