export interface LaunchAtLoginStatus {
  supported: boolean;
  enabled: boolean;
}

export interface LaunchAtLogin {
  status(): Promise<LaunchAtLoginStatus>;
  enable(): Promise<void>;
  disable(): Promise<void>;
}
