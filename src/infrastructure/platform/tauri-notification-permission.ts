import { requestPermission } from '@tauri-apps/plugin-notification';
import type { NotificationPermission, NotificationPermissionState } from '../../application/ports';
import type { TauriCommands } from './tauri-commands';

export interface NotificationApi {
  request(): Promise<'granted' | 'denied' | 'default'>;
}

const pluginApi: NotificationApi = { request: requestPermission };

const KNOWN_STATES: readonly NotificationPermissionState[] = ['granted', 'denied', 'prompt', 'unknown'];

export function toPermissionState(raw: unknown): NotificationPermissionState {
  return KNOWN_STATES.find((state) => state === raw) ?? 'unknown';
}

export class TauriNotificationPermission implements NotificationPermission {
  constructor(
    private readonly commands: TauriCommands,
    private readonly api: NotificationApi = pluginApi,
  ) {}

  async status(): Promise<NotificationPermissionState> {
    try {
      return toPermissionState(await this.commands.call<string>('notification_permission_state'));
    } catch {
      return 'unknown';
    }
  }

  async request(): Promise<NotificationPermissionState> {
    await this.api.request();
    return this.status();
  }
}
