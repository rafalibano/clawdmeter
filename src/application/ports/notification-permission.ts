export type NotificationPermissionState = 'granted' | 'denied' | 'prompt';

export interface NotificationPermission {
  status(): Promise<NotificationPermissionState>;
  request(): Promise<NotificationPermissionState>;
}
