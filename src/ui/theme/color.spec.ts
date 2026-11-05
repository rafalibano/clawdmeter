import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS } from './accent-presets';
import { contrastRatio, parseHexInput, readableTextOn } from './color';

describe('readableTextOn', () => {
  it('uses dark text on a light background and light text on a dark one', () => {
    expect(readableTextOn('#ffffff')).toBe('#121212');
    expect(readableTextOn('#101010')).toBe('#ffffff');
  });

  it('falls back to dark text with an invalid color', () => {
    expect(readableTextOn('azul')).toBe('#121212');
  });

  it('Mottu green takes dark text (AA); dark presets take white', () => {
    expect(readableTextOn('#00b131')).toBe('#121212');
    expect(readableTextOn('#1bd60b')).toBe('#121212');
    expect(readableTextOn('#006e1b')).toBe('#ffffff');
  });

  it('every accent preset has AA contrast with the chosen text', () => {
    for (const { color } of ACCENT_PRESETS) {
      expect(contrastRatio(color, readableTextOn(color))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('parseHexInput', () => {
  it('accepts 6 digits with or without #, in any case', () => {
    expect(parseHexInput('#A1B2C3')).toBe('#a1b2c3');
    expect(parseHexInput('a1b2c3')).toBe('#a1b2c3');
    expect(parseHexInput('  #00B131  ')).toBe('#00b131');
  });

  it('expands the short format', () => {
    expect(parseHexInput('#fa0')).toBe('#ffaa00');
    expect(parseHexInput('0f0')).toBe('#00ff00');
  });

  it('rejects what is not a hexadecimal color', () => {
    for (const text of ['', '#', '#12', '#1234', '#12345', '#1234567', '#gggggg', 'azul', '##fff', '#12 345']) {
      expect(parseHexInput(text)).toBeNull();
    }
  });
});
