import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../domain/time';
import { formatAxisTick, formatClock, formatDayClock, formatSince, formatSpan } from './time';

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

describe('formatClock e formatDayClock', () => {
  it('hora local com zero à esquerda', () => {
    expect(formatClock(at(5, 7, 5))).toBe('07:05');
    expect(formatClock(at(5, 17, 0))).toBe('17:00');
  });

  it('no mesmo dia só a hora; em outro dia leva o dia da semana', () => {
    expect(formatDayClock(at(5, 17), at(5, 9))).toBe('17:00');
    expect(formatDayClock(at(9, 17), at(5, 9))).toBe('seg 17:00');
  });
});

describe('formatAxisTick', () => {
  it('até 1 dia mostra hora; acima disso, dia/mês', () => {
    expect(formatAxisTick(at(5, 17, 30), DAY_MS)).toBe('17:30');
    expect(formatAxisTick(at(5, 17, 30), 7 * DAY_MS)).toBe('05/11');
  });
});

describe('formatSpan e formatSince', () => {
  it.each([
    [10_000, 'menos de 1 min'],
    [45 * MINUTE_MS, '45 min'],
    [80 * MINUTE_MS, '1h20'],
    [2 * HOUR_MS, '2h'],
    [2 * HOUR_MS + 59.8 * MINUTE_MS, '3h'],
    [26 * HOUR_MS, '1d2h'],
    [2 * DAY_MS, '2d'],
    [-5, 'menos de 1 min'],
  ])('formatSpan(%d) = %s', (ms, text) => {
    expect(formatSpan(ms)).toBe(text);
  });

  it('formatSince: agora ou há X', () => {
    expect(formatSince(20_000)).toBe('agora');
    expect(formatSince(12 * MINUTE_MS)).toBe('há 12 min');
  });
});
