import { describe, expect, it } from 'vitest';
import { chartPalette, withAlpha } from './chart-palette';

describe('chartPalette', () => {
  it('converte hex em rgba', () => {
    expect(withAlpha('#121212', 0.5)).toBe('rgba(18, 18, 18, 0.5)');
  });

  it('tema claro usa texto escuro e o verde Mottu nas linhas', () => {
    const palette = chartPalette('#00b131', null, 'light');
    expect(palette.line).toBe('#00b131');
    expect(palette.area).toBe('#00b131');
    expect(palette.text).toBe('#121212');
    expect(palette.grid).toBe('rgba(18, 18, 18, 0.14)');
  });

  it('tendência do verde Mottu usa primary-alt; destaque customizado mantém a própria cor', () => {
    expect(chartPalette('#00b131', null, 'dark').trend).toBe('#1bd60b');
    expect(chartPalette('#0063f7', null, 'dark').trend).toBe('#0063f7');
  });

  it('linha de 100% usa alert-base e a fonte é Helvetica', () => {
    const palette = chartPalette('#00b131', null, 'dark');
    expect(palette.danger).toBe('#ff5449');
    expect(palette.fontFamily).toBe('"Helvetica Neue", Helvetica, Arial, sans-serif');
  });

  it('tema escuro usa texto branco; fundo personalizado manda no contraste', () => {
    expect(chartPalette('#00b131', null, 'dark').text).toBe('#ffffff');
    expect(chartPalette('#00b131', '#ffffff', 'dark').text).toBe('#121212');
  });
});
