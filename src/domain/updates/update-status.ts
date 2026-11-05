export type UpdateErrorReason = 'rate-limited' | 'no-access' | 'failed';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'github-required' }
  | { state: 'up-to-date' }
  | { state: 'available'; version: string; notes: string | null }
  | { state: 'downloading'; version: string; downloaded: number; total: number | null }
  | { state: 'installed'; version: string }
  | { state: 'error'; during: 'check' | 'install'; reason: UpdateErrorReason; version: string | null };

export interface UpdateSnapshot {
  status: UpdateStatus;
  currentVersion: string | null;
  lastCheckedAt: number | null;
}

export const INITIAL_UPDATE_SNAPSHOT: UpdateSnapshot = { status: { state: 'idle' }, currentVersion: null, lastCheckedAt: null };

export function shouldShowUpdateBanner(status: UpdateStatus): boolean {
  switch (status.state) {
    case 'available':
    case 'downloading':
    case 'installed':
      return true;
    case 'error':
      return status.during === 'install';
    default:
      return false;
  }
}

export function downloadPercent(downloaded: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.floor((downloaded / total) * 100)));
}

export class UpdateAccessError extends Error {
  constructor(message = 'update_access_denied') {
    super(message);
    this.name = 'UpdateAccessError';
  }
}
