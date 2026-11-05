import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import type { NotificationPermission, NotificationPermissionState } from '../../application/ports';

export interface NotificationApi {
  isGranted(): Promise<boolean>;
  request(): Promise<'granted' | 'denied' | 'default'>;
}

const pluginApi: NotificationApi = { isGranted: isPermissionGranted, request: requestPermission };

export class TauriNotificationPermission implements NotificationPermission {
  constructor(private readonly api: NotificationApi = pluginApi) {}

  async status(): Promise<NotificationPermissionState> {
    return (await this.api.isGranted()) ? 'granted' : 'prompt';
  }

  async request(): Promise<NotificationPermissionState> {
    const result = await this.api.request();
    return result === 'default' ? 'prompt' : result;
  }
}
