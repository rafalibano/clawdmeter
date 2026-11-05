import { describe, expect, it } from 'vitest';
import { formatUpdatedAgo } from './elapsed';

describe('formatUpdatedAgo', () => {
  it('avisa quando ainda não há dados', () => {
    expect(formatUpdatedAgo(null, 1_000)).toBe('aguardando dados');
  });

  it('usa segundos, minutos e horas', () => {
    expect(formatUpdatedAgo(0, 12_900)).toBe('atualizado há 12s');
    expect(formatUpdatedAgo(0, 61_000)).toBe('atualizado há 1 min');
    expect(formatUpdatedAgo(0, 2 * 3_600_000)).toBe('atualizado há 2 h');
  });

  it('não devolve tempo negativo se o relógio voltar', () => {
    expect(formatUpdatedAgo(5_000, 1_000)).toBe('atualizado há 0s');
  });
});
