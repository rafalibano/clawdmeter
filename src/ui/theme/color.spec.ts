import { describe, expect, it } from 'vitest';
import { readableTextOn } from './color';

describe('readableTextOn', () => {
  it('usa texto escuro em fundo claro e claro em fundo escuro', () => {
    expect(readableTextOn('#ffffff')).toBe('#1c1c1e');
    expect(readableTextOn('#101010')).toBe('#f5f5f7');
  });

  it('cai no texto escuro com cor inválida', () => {
    expect(readableTextOn('azul')).toBe('#1c1c1e');
  });
});
