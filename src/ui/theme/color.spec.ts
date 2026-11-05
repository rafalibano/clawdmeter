import { describe, expect, it } from 'vitest';
import { parseHexInput, readableTextOn } from './color';

describe('readableTextOn', () => {
  it('usa texto escuro em fundo claro e claro em fundo escuro', () => {
    expect(readableTextOn('#ffffff')).toBe('#1c1c1e');
    expect(readableTextOn('#101010')).toBe('#f5f5f7');
  });

  it('cai no texto escuro com cor inválida', () => {
    expect(readableTextOn('azul')).toBe('#1c1c1e');
  });
});

describe('parseHexInput', () => {
  it('aceita 6 dígitos com ou sem #, em qualquer caixa', () => {
    expect(parseHexInput('#A1B2C3')).toBe('#a1b2c3');
    expect(parseHexInput('a1b2c3')).toBe('#a1b2c3');
    expect(parseHexInput('  #6366F1  ')).toBe('#6366f1');
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
