import { describe, expect, it } from 'vitest';
import { slaLevel } from './sla';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

describe('slaLevel', () => {
  it('menos de 3 dias é fresh', () => {
    expect(slaLevel(NOW, NOW)).toBe('fresh');
    expect(slaLevel(NOW - (2 * DAY + 23 * HOUR), NOW)).toBe('fresh');
  });

  it('de 3 dias até 6d23h é attention', () => {
    expect(slaLevel(NOW - 3 * DAY, NOW)).toBe('attention');
    expect(slaLevel(NOW - (6 * DAY + 23 * HOUR), NOW)).toBe('attention');
  });

  it('a partir de 7 dias é overdue', () => {
    expect(slaLevel(NOW - 7 * DAY, NOW)).toBe('overdue');
    expect(slaLevel(NOW - 30 * DAY, NOW)).toBe('overdue');
  });

  it('data no futuro (relógio adiantado) é fresh', () => {
    expect(slaLevel(NOW + DAY, NOW)).toBe('fresh');
  });
});
