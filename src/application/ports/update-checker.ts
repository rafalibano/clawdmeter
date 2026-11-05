export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

export interface UpdateChecker {
  currentVersion(): Promise<string>;
  check(token: string): Promise<AvailableUpdate | null>;
  install(token: string, onProgress: (progress: DownloadProgress) => void): Promise<void>;
  restart(): Promise<void>;
}
