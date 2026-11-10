import type { NotificationPermission, NotificationPermissionState } from '../../application/ports';
import type { TauriCommands } from './tauri-commands';

const KNOWN_STATES: readonly NotificationPermissionState[] = ['granted', 'denied', 'prompt', 'unknown'];

export function toPermissionState(raw: unknown): NotificationPermissionState {
  return KNOWN_STATES.find((state) => state === raw) ?? 'unknown';
}

export class TauriNotificationPermission implements NotificationPermission {
  constructor(private readonly commands: TauriCommands) {}

  async status(): Promise<NotificationPermissionState> {
    try {
      return toPermissionState(await this.commands.call<string>('notification_permission_state'));
    } catch {
      return 'unknown';
    }
  }

  async request(): Promise<NotificationPermissionState> {
    try {
      return toPermissionState(await this.commands.call<string>('notification_permission_request'));
    } catch {
      return 'unknown';
    }
  }
}
