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

describe('resumos das seções de Ajustes', () => {
  const pt = new Localizer('pt-BR');

  it('páginas: ativas de total', () => {
    expect(pagesSummary(pt, [{ enabled: true }, { enabled: false }, { enabled: true }])).toBe('2 de 3 ativas');
  });

  it('páginas nas três línguas', () => {
    const rows = [{ enabled: true }, { enabled: false }];
    expect(pagesSummary(new Localizer('en'), rows)).toBe('1 of 2 active');
    expect(pagesSummary(new Localizer('es-MX'), rows)).toBe('1 de 2 activas');
  });

  it('conexões: ok verde, erro atenção, o resto cinza', () => {
    expect(connectionDots(['ok', 'error', 'idle', 'busy'])).toEqual(['ok', 'attention', 'off', 'off']);
  });

  it('conexões: abre sozinha só com erro', () => {
    expect(connectionsNeedAttention(['ok', 'idle', 'busy'])).toBe(false);
    expect(connectionsNeedAttention(['ok', 'error'])).toBe(true);
  });

  it('conexões: texto de atenção só com erro', () => {
    expect(connectionsAttentionText(pt, ['ok'])).toBeNull();
    expect(connectionsAttentionText(pt, ['error', 'error'])).toBe('2 com atenção');
  });

  it('projeção e aparência mostram o rótulo escolhido', () => {
    expect(projectionSummary(pt, '14d')).toBe('Últimos 14 dias');
    expect(appearanceSummary(pt, 'dark')).toBe('Escuro');
  });
});
