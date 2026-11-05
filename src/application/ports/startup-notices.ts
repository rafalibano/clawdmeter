export type StartupNotice = 'no-tray';

export interface StartupNotices {
  pending(): Promise<StartupNotice | null>;
}
