import { errorStatus, noteStatus, type ConnectionStatus } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { NotificationPermission, NotificationPermissionState } from '../../../ports';

export function statusOfPermission(state: NotificationPermissionState): ConnectionStatus {
  if (state === 'granted') return { state: 'connected' };
  if (state === 'denied') return errorStatus('notifications-blocked');
  if (state === 'unknown') return errorStatus('notifications-unverifiable');
  return noteStatus('notifications-blocked', 'notifications-not-authorized');
}

export class CheckNotifications implements StatusUseCase {
  constructor(private readonly permission: NotificationPermission) {}

  async execute(): Promise<ConnectionStatus> {
    return statusOfPermission(await this.permission.status());
  }
}
