import { describe, expect, it } from 'vitest';
import { HOUR_MS } from '../time';
import { localMidnightsBetween, projectionDays } from './projection-days';

const NOW = new Date(2026, 10, 5, 15, 0).getTime();

describe('day boundaries', () => {
  it('lists the local 00:00 marks between now and the reset, without repeating the reset', () => {
    const resetsAt = new Date(2026, 10, 9, 10, 0).getTime();
    const midnights = localMidnightsBetween(NOW, resetsAt);
    expect(midnights.map((at) => new Date(at).getDate())).toEqual([6, 7, 8, 9]);
    expect(midnights.every((at) => new Date(at).getHours() === 0 && new Date(at).getMinutes() === 0)).toBe(true);
    const atMidnight = new Date(2026, 10, 9, 0, 0).getTime();
    expect(localMidnightsBetween(NOW, atMidnight).map((at) => new Date(at).getDate())).toEqual([6, 7, 8]);
  });

  it('projectionDays returns one point per boundary and the final point at the reset', () => {
    const resetsAt = new Date(2026, 10, 8, 12, 0).getTime();
    const days = projectionDays({ fromAt: NOW, fromValue: 40, toAt: resetsAt, toValue: 40 + (resetsAt - NOW) / HOUR_MS });
    expect(days.map((day) => day.at)).toEqual([
      new Date(2026, 10, 6).getTime(),
      new Date(2026, 10, 7).getTime(),
      new Date(2026, 10, 8).getTime(),
      resetsAt,
    ]);
    expect(days[0]!.value).toBeCloseTo(40 + 9, 5);
    expect(days[3]!.value).toBeCloseTo(40 + (resetsAt - NOW) / HOUR_MS, 5);
  });
});
