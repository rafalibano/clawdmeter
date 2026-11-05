import { describe, expect, it } from 'vitest';
import { Localizer } from '../i18n';
import {
  appearanceSummary,
  connectionDots,
  connectionsAttentionText,
  connectionsNeedAttention,
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
});
