import { errorStatus, type ConnectionStatus } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { NotificationPermission, NotificationPermissionState } from '../../../ports';

const NOT_AUTHORIZED_MESSAGE = 'O sistema ainda não liberou as notificações do Dev Pulse. Libere nos ajustes do sistema.';

export function statusOfPermission(state: NotificationPermissionState): ConnectionStatus {
  if (state === 'granted') return { state: 'connected' };
  if (state === 'denied') return errorStatus('notifications-blocked');
  if (state === 'unknown') return errorStatus('notifications-unverifiable');
  return errorStatus('notifications-blocked', NOT_AUTHORIZED_MESSAGE);
}

export class CheckNotifications implements StatusUseCase {
  constructor(private readonly permission: NotificationPermission) {}

  async execute(): Promise<ConnectionStatus> {
    return statusOfPermission(await this.permission.status());
  }
}
