import { downloadPercent, type UpdateSnapshot, type UpdateStatus } from '../../domain/updates';
import type { Localizer } from '../i18n';

export type BannerAction = 'install' | 'restart' | 'retry-install' | null;

export interface BannerView {
  text: string;
  action: BannerAction;
  dismissible: boolean;
}

function downloadingText(l: Localizer, status: Extract<UpdateStatus, { state: 'downloading' }>): string {
  const percent = downloadPercent(status.downloaded, status.total);
  return percent === null
    ? l.t('updates.banner.downloading', { version: status.version })
    : l.t('updates.banner.downloadingPercent', { version: status.version, percent });
}

export function bannerView(l: Localizer, status: UpdateStatus): BannerView | null {
  switch (status.state) {
    case 'available':
      return { text: l.t('updates.banner.available', { version: status.version }), action: 'install', dismissible: false };
    case 'downloading':
      return { text: downloadingText(l, status), action: null, dismissible: false };
    case 'installed':
      return { text: l.t('updates.banner.installed', { version: status.version }), action: 'restart', dismissible: true };
    case 'error':
      return status.during === 'install'
        ? { text: l.t('updates.error.install'), action: 'retry-install', dismissible: false }
        : null;
    default:
      return null;
  }
}

export function statusText(l: Localizer, status: UpdateStatus): string {
  switch (status.state) {
    case 'available':
      return l.t('updates.status.available', { version: status.version });
    case 'downloading':
      return downloadingText(l, status);
    case 'installed':
      return l.t('updates.status.installed', { version: status.version });
    case 'error':
      return status.during === 'install' ? l.t('updates.error.install') : l.t(`updates.error.${status.reason}`);
    default:
      return l.t(`updates.status.${status.state}`);
  }
}

export function lastCheckText(l: Localizer, snapshot: UpdateSnapshot, now: number): string {
  return snapshot.lastCheckedAt === null ? l.t('updates.never') : l.since(now - snapshot.lastCheckedAt);
}

export function updatesSummary(l: Localizer, snapshot: UpdateSnapshot): string {
  const status = snapshot.status;
  if (status.state === 'available') return l.t('updates.status.available', { version: status.version });
  return snapshot.currentVersion === null ? '' : l.t('updates.summary.version', { version: snapshot.currentVersion });
}

export function canCheckNow(status: UpdateStatus): boolean {
  return !['checking', 'downloading', 'installed'].includes(status.state);
}
