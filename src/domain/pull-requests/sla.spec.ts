import { describe, expect, it } from 'vitest';
import { slaLevel } from './sla';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

describe('slaLevel', () => {
  it('less than 3 days is fresh', () => {
    expect(slaLevel(NOW, NOW)).toBe('fresh');
    expect(slaLevel(NOW - (2 * DAY + 23 * HOUR), NOW)).toBe('fresh');
  });

  it('from 3 days up to 6d23h is attention', () => {
    expect(slaLevel(NOW - 3 * DAY, NOW)).toBe('attention');
    expect(slaLevel(NOW - (6 * DAY + 23 * HOUR), NOW)).toBe('attention');
  });

  it('from 7 days on is overdue', () => {
    expect(slaLevel(NOW - 7 * DAY, NOW)).toBe('overdue');
    expect(slaLevel(NOW - 30 * DAY, NOW)).toBe('overdue');
  });

  it('a date in the future (clock ahead) is fresh', () => {
    expect(slaLevel(NOW + DAY, NOW)).toBe('fresh');
  });
});
