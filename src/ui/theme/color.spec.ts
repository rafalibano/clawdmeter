import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS } from './accent-presets';
import { contrastRatio, parseHexInput, readableTextOn } from './color';

describe('readableTextOn', () => {
  it('usa texto escuro em fundo claro e claro em fundo escuro', () => {
    expect(readableTextOn('#ffffff')).toBe('#121212');
    expect(readableTextOn('#101010')).toBe('#ffffff');
  });

  it('cai no texto escuro com cor inválida', () => {
    expect(readableTextOn('azul')).toBe('#121212');
  });

  it('o verde Mottu leva texto escuro (AA); os presets escuros levam branco', () => {
    expect(readableTextOn('#00b131')).toBe('#121212');
    expect(readableTextOn('#1bd60b')).toBe('#121212');
    expect(readableTextOn('#006e1b')).toBe('#ffffff');
  });

  it('todo preset de destaque tem contraste AA com o texto escolhido', () => {
    for (const { color } of ACCENT_PRESETS) {
      expect(contrastRatio(color, readableTextOn(color))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('parseHexInput', () => {
  it('aceita 6 dígitos com ou sem #, em qualquer caixa', () => {
    expect(parseHexInput('#A1B2C3')).toBe('#a1b2c3');
    expect(parseHexInput('a1b2c3')).toBe('#a1b2c3');
    expect(parseHexInput('  #00B131  ')).toBe('#00b131');
  });

  it('expande o formato curto', () => {
    expect(parseHexInput('#fa0')).toBe('#ffaa00');
    expect(parseHexInput('0f0')).toBe('#00ff00');
  });

  it('rejeita o que não é cor hexadecimal', () => {
    for (const text of ['', '#', '#12', '#1234', '#12345', '#1234567', '#gggggg', 'azul', '##fff', '#12 345']) {
      expect(parseHexInput(text)).toBeNull();
    }
  });
});
