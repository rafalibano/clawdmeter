export type NotificationPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface NotificationPermission {
  status(): Promise<NotificationPermissionState>;
  request(): Promise<NotificationPermissionState>;
}
