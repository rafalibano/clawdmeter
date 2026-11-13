import type { ConnectionTone } from './connections/connection-view';
import type { Localizer } from '../i18n';
import type { ProjectionMethod } from '../../domain/usage';
import type { ThemeMode } from '../../domain/settings';

export type StatusDot = 'ok' | 'attention' | 'off';

export function pagesSummary(l: Localizer, rows: readonly { enabled: boolean }[]): string {
  return l.t('settings.pages.summary', {
    active: String(rows.filter((row) => row.enabled).length),
    total: String(rows.length),
  });
}

export function connectionDots(tones: readonly ConnectionTone[]): StatusDot[] {
  return tones.map((tone) => (tone === 'ok' ? 'ok' : tone === 'error' ? 'attention' : 'off'));
}

export function connectionsNeedAttention(tones: readonly ConnectionTone[]): boolean {
  return tones.includes('error');
}

export function connectionsAttentionText(l: Localizer, tones: readonly ConnectionTone[]): string | null {
  const count = tones.filter((tone) => tone === 'error').length;
  return count === 0 ? null : l.t('connections.summary.attention', { count: String(count) });
}

export function projectionSummary(l: Localizer, method: ProjectionMethod): string {
  return l.t(`projection.${method}`);
}

export function usageTabSummary(l: Localizer, dailyHistory: boolean): string {
  return l.t(dailyHistory ? 'settings.usageTab.summary.on' : 'settings.usageTab.summary.off');
}

export function appearanceSummary(l: Localizer, theme: ThemeMode): string {
  return l.t(`theme.${theme}`);
}

export interface LaunchAtLoginView {
  loaded: boolean;
  enabled: boolean;
  failed: 'read' | 'write' | false;
}

export function launchAtLoginSummary(l: Localizer, view: LaunchAtLoginView): string {
  if (!view.loaded || view.failed === 'read') return l.t('settings.launchAtLogin.unknown');
  return l.t(view.enabled ? 'settings.launchAtLogin.on' : 'settings.launchAtLogin.off');
}

export function launchAtLoginDescribedBy(failed: 'read' | 'write' | false): string {
  return failed ? 'launch-at-login-hint launch-at-login-error' : 'launch-at-login-hint';
}
