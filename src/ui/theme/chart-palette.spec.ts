import { describe, expect, it } from 'vitest';
import { chartPalette, withAlpha } from './chart-palette';

describe('chartPalette', () => {
  it('converte hex em rgba', () => {
    expect(withAlpha('#1c1c1e', 0.5)).toBe('rgba(28, 28, 30, 0.5)');
  });

  it('tema claro usa texto escuro e o destaque nas linhas', () => {
    const palette = chartPalette('#6366f1', null, 'light');
    expect(palette.line).toBe('#6366f1');
    expect(palette.text).toBe('#1c1c1e');
    expect(palette.grid).toBe('rgba(28, 28, 30, 0.14)');
  });

  it('tema escuro usa texto claro; fundo personalizado manda no contraste', () => {
    expect(chartPalette('#6366f1', null, 'dark').text).toBe('#f5f5f7');
    expect(chartPalette('#6366f1', '#ffffff', 'dark').text).toBe('#1c1c1e');
  });
});
