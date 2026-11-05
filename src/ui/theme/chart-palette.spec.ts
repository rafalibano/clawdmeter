import { describe, expect, it } from 'vitest';
import { chartPalette, withAlpha } from './chart-palette';

describe('chartPalette', () => {
  it('converte hex em rgba', () => {
    expect(withAlpha('#121212', 0.5)).toBe('rgba(18, 18, 18, 0.5)');
  });

  it('tema claro: 5h em primary-base, 7d em cinza neutro, texto escuro e grade leve', () => {
    const palette = chartPalette('#00b131', null, 'light');
    expect(palette.series.fiveHour.line).toBe('#00b131');
    expect(palette.series.sevenDay.line).toBe('#767676');
    expect(palette.series.fiveHour.area).toBe('rgba(0, 177, 49, 0.1)');
    expect(palette.series.fiveHour.areaFade).toBe('rgba(0, 177, 49, 0)');
    expect(palette.text).toBe('#121212');
    expect(palette.grid).toBe('rgba(18, 18, 18, 0.06)');
    expect(palette.tooltipBackground).toBe('#ffffff');
  });

  it('tema escuro: 5h em primary-alt, 7d em cinza neutro', () => {
    const palette = chartPalette('#00b131', null, 'dark');
    expect(palette.series.fiveHour.line).toBe('#1bd60b');
    expect(palette.series.sevenDay.line).toBe('#a9a9a9');
  });

  it('destaque customizado manda na série de 5h e não na de 7d', () => {
    const palette = chartPalette('#ef6800', null, 'dark');
    expect(palette.series.fiveHour.line).toBe('#ef6800');
    expect(palette.series.sevenDay.line).toBe('#a9a9a9');
  });

  it('alerta em alert-base, atenção em amarelo e a fonte é Helvetica', () => {
    const palette = chartPalette('#00b131', null, 'dark');
    expect(palette.danger).toBe('#ff5449');
    expect(palette.attention).toBe('#ffc700');
    expect(palette.fontFamily).toBe('"Helvetica Neue", Helvetica, Arial, sans-serif');
  });

  it('grade e linha de agora no escuro são brancas translúcidas e o tooltip usa o card suave', () => {
    const palette = chartPalette('#00b131', null, 'dark');
    expect(palette.grid).toBe('rgba(255, 255, 255, 0.06)');
    expect(palette.now).toBe('rgba(255, 255, 255, 0.3)');
    expect(palette.tooltipBackground).toBe('#202022');
    expect(chartPalette('#00b131', '#101010', 'dark').tooltipBackground).toBe('#101010');
  });

  it('tema escuro usa texto branco; fundo personalizado manda no contraste', () => {
    expect(chartPalette('#00b131', null, 'dark').text).toBe('#ffffff');
    expect(chartPalette('#00b131', '#ffffff', 'dark').text).toBe('#121212');
  });
});
