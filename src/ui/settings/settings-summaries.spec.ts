import { describe, expect, it } from 'vitest';
import { Localizer } from '../i18n';
import {
  appearanceSummary,
  connectionDots,
  connectionsAttentionText,
  connectionsNeedAttention,
  launchAtLoginDescribedBy,
  launchAtLoginSummary,
  pagesSummary,
  projectionSummary,
} from './settings-summaries';

describe('settings section summaries', () => {
  const pt = new Localizer('pt-BR');

  it('pages: active out of total', () => {
    expect(pagesSummary(pt, [{ enabled: true }, { enabled: false }, { enabled: true }])).toBe('2 de 3 ativas');
  });

  it('pages in the three languages', () => {
    const rows = [{ enabled: true }, { enabled: false }];
    expect(pagesSummary(new Localizer('en'), rows)).toBe('1 of 2 active');
    expect(pagesSummary(new Localizer('es-MX'), rows)).toBe('1 de 2 activas');
  });

  it('connections: ok is green, error is attention, the rest is gray', () => {
    expect(connectionDots(['ok', 'error', 'idle', 'busy'])).toEqual(['ok', 'attention', 'off', 'off']);
  });

  it('connections: opens by itself only on error', () => {
    expect(connectionsNeedAttention(['ok', 'idle', 'busy'])).toBe(false);
    expect(connectionsNeedAttention(['ok', 'error'])).toBe(true);
  });

  it('connections: attention text only on error', () => {
    expect(connectionsAttentionText(pt, ['ok'])).toBeNull();
    expect(connectionsAttentionText(pt, ['error', 'error'])).toBe('2 com atenção');
  });

  it('projection and appearance show the chosen label', () => {
    expect(projectionSummary(pt, '14d')).toBe('Últimos 14 dias');
    expect(projectionSummary(pt, '7d')).toBe('Últimos 7 dias');
    expect(appearanceSummary(pt, 'dark')).toBe('Escuro');
  });

  describe('launch at login', () => {
    const en = new Localizer('en');

    it('summary shows Off and On from the real state', () => {
      expect(launchAtLoginSummary(en, { loaded: true, enabled: false, failed: false })).toBe(en.t('settings.launchAtLogin.off'));
      expect(launchAtLoginSummary(en, { loaded: true, enabled: true, failed: false })).toBe(en.t('settings.launchAtLogin.on'));
    });

    it('summary is unavailable after a failed read', () => {
      expect(launchAtLoginSummary(en, { loaded: true, enabled: false, failed: 'read' })).toBe(
        en.t('settings.launchAtLogin.unknown'),
      );
    });

    it('summary keeps the known state after a failed write', () => {
      expect(launchAtLoginSummary(en, { loaded: true, enabled: true, failed: 'write' })).toBe(en.t('settings.launchAtLogin.on'));
      expect(launchAtLoginSummary(en, { loaded: true, enabled: false, failed: 'write' })).toBe(en.t('settings.launchAtLogin.off'));
    });

    it('summary is unavailable before the first load', () => {
      expect(launchAtLoginSummary(en, { loaded: false, enabled: false, failed: false })).toBe(
        en.t('settings.launchAtLogin.unknown'),
      );
    });

    it('the switch points at the error only while there is a failure', () => {
      expect(launchAtLoginDescribedBy(false)).toBe('launch-at-login-hint');
      expect(launchAtLoginDescribedBy('read')).toBe('launch-at-login-hint launch-at-login-error');
      expect(launchAtLoginDescribedBy('write')).toBe('launch-at-login-hint launch-at-login-error');
    });
  });
});
