import { describe, expect, it } from 'vitest';
import { chartPalette, withAlpha } from './chart-palette';

describe('chartPalette', () => {
  it('converts hex to rgba', () => {
    expect(withAlpha('#121212', 0.5)).toBe('rgba(18, 18, 18, 0.5)');
  });

  it('light theme: 5h in primary-base, 7d in neutral gray, dark text and light grid', () => {
    const palette = chartPalette('#00b131', null, 'light');
    expect(palette.series.fiveHour.line).toBe('#00b131');
    expect(palette.series.sevenDay.line).toBe('#767676');
    expect(palette.series.fiveHour.area).toBe('rgba(0, 177, 49, 0.1)');
    expect(palette.series.fiveHour.areaFade).toBe('rgba(0, 177, 49, 0)');
    expect(palette.text).toBe('#121212');
    expect(palette.grid).toBe('rgba(18, 18, 18, 0.06)');
    expect(palette.tooltipBackground).toBe('#ffffff');
  });

  it('dark theme: 5h in primary-alt, 7d in neutral gray', () => {
    const palette = chartPalette('#00b131', null, 'dark');
    expect(palette.series.fiveHour.line).toBe('#1bd60b');
    expect(palette.series.sevenDay.line).toBe('#a9a9a9');
  });

  it('custom accent drives the 5h series and not the 7d one', () => {
    const palette = chartPalette('#ef6800', null, 'dark');
    expect(palette.series.fiveHour.line).toBe('#ef6800');
    expect(palette.series.sevenDay.line).toBe('#a9a9a9');
  });

  it('alert in alert-base, warning in yellow and the font is Helvetica', () => {
    const palette = chartPalette('#00b131', null, 'dark');
    expect(palette.danger).toBe('#ff5449');
    expect(palette.fontFamily).toBe('"Helvetica Neue", Helvetica, Arial, sans-serif');
  });

  it('grid and now line in dark are translucent white and the tooltip uses the soft card', () => {
    const palette = chartPalette('#00b131', null, 'dark');
    expect(palette.grid).toBe('rgba(255, 255, 255, 0.06)');
    expect(palette.now).toBe('rgba(255, 255, 255, 0.3)');
    expect(palette.tooltipBackground).toBe('#202022');
    expect(chartPalette('#00b131', '#101010', 'dark').tooltipBackground).toBe('#101010');
  });

  it('dark theme uses white text; custom background drives the contrast', () => {
    expect(chartPalette('#00b131', null, 'dark').text).toBe('#ffffff');
    expect(chartPalette('#00b131', '#ffffff', 'dark').text).toBe('#121212');
  });
});

describe('chosen series colors', () => {
  it('replace the line, area and marker of each series in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const palette = chartPalette('#00b131', null, theme, { fiveHour: '#0063f7', sevenDay: '#ef6800' });
      expect(palette.series.fiveHour.line).toBe('#0063f7');
      expect(palette.series.fiveHour.area).toBe('rgba(0, 99, 247, 0.1)');
      expect(palette.series.sevenDay.line).toBe('#ef6800');
      expect(palette.series.sevenDay.marker).toBe('rgba(239, 104, 0, 0.28)');
    }
  });

  it('the chart text does not change with the series color', () => {
    const base = chartPalette('#00b131', null, 'dark');
    const dark = chartPalette('#00b131', null, 'dark', { fiveHour: '#000000', sevenDay: '#121212' });
    expect(dark.text).toBe(base.text);
    expect(dark.muted).toBe(base.muted);
    expect(dark.series.fiveHour.line).toBe('#000000');
  });

  it('a single chosen color keeps the default of the other', () => {
    const palette = chartPalette('#00b131', null, 'light', { fiveHour: null, sevenDay: '#0063f7' });
    expect(palette.series.fiveHour.line).toBe('#00b131');
    expect(palette.series.sevenDay.line).toBe('#0063f7');
  });
});
