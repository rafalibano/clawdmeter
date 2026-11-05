import { describe, expect, it } from 'vitest';
import { createEmptyHistory, parseHistory, recordSnapshot, serializeHistory } from './usage-history';
import { pointsInRange, usageRange, USAGE_RANGES } from './usage-range';
import { HOUR_MS } from '../time';

describe('recordSnapshot', () => {
  it('adds one point per present window', () => {
    const history = recordSnapshot(createEmptyHistory(), { fiveHour: { utilization: 10, resetsAt: 5 }, sevenDay: null }, 100);
    expect(history.fiveHour).toEqual([{ at: 100, utilization: 10, resetsAt: 5 }]);
    expect(history.sevenDay).toEqual([]);
  });

  it('does not mutate the previous history and keeps the order', () => {
    const base = recordSnapshot(createEmptyHistory(), { fiveHour: { utilization: 1, resetsAt: null }, sevenDay: null }, 200);
    const next = recordSnapshot(base, { fiveHour: { utilization: 2, resetsAt: null }, sevenDay: null }, 300);
    expect(base.fiveHour).toHaveLength(1);
    expect(next.fiveHour.map((point) => point.at)).toEqual([200, 300]);
  });

  it('a repeated timestamp replaces the point; out of order gets reordered', () => {
    let history = recordSnapshot(createEmptyHistory(), { fiveHour: { utilization: 1, resetsAt: null }, sevenDay: null }, 200);
    history = recordSnapshot(history, { fiveHour: { utilization: 9, resetsAt: null }, sevenDay: null }, 200);
    history = recordSnapshot(history, { fiveHour: { utilization: 5, resetsAt: null }, sevenDay: null }, 100);
    expect(history.fiveHour.map((point) => [point.at, point.utilization])).toEqual([
      [100, 5],
      [200, 9],
    ]);
  });
});

describe('serialization', () => {
  it('round trip preserves the points', () => {
    const history = {
      fiveHour: [{ at: 1, utilization: 2.5, resetsAt: 9 }],
      sevenDay: [{ at: 3, utilization: 4, resetsAt: null }],
    };
    expect(parseHistory(JSON.parse(JSON.stringify(serializeHistory(history))))).toEqual(history);
  });

  it('the imported flag survives the round trip and old points remain valid', () => {
    const history = {
      fiveHour: [
        { at: 1, utilization: 2, resetsAt: null, imported: true as const },
        { at: 2, utilization: 3, resetsAt: 9 },
      ],
      sevenDay: [],
    };
    expect(parseHistory(JSON.parse(JSON.stringify(serializeHistory(history))))).toEqual(history);
    expect(parseHistory({ fiveHour: [[5, 1, null, 0]], sevenDay: [] }).fiveHour).toEqual([{ at: 5, utilization: 1, resetsAt: null }]);
  });

  it('tolerant parse: garbage becomes an empty history or drops invalid entries', () => {
    expect(parseHistory(null)).toEqual(createEmptyHistory());
    expect(parseHistory({ fiveHour: 'x' })).toEqual(createEmptyHistory());
    const parsed = parseHistory({ fiveHour: [[2, 5, null], 'x', [1, 'a', null], [1, 3, 'z'], [NaN, 1, null]], sevenDay: [] });
    expect(parsed.fiveHour).toEqual([
      { at: 1, utilization: 3, resetsAt: null },
      { at: 2, utilization: 5, resetsAt: null },
    ]);
  });
});

describe('range selector', () => {
  it('offers 1h, 6h, 1d, 7d, 30d and the weekly cycle', () => {
    expect(USAGE_RANGES.map((range) => range.id)).toEqual(['1h', '6h', '1d', '7d', '30d', 'cycle']);
  });

  it('unknown id falls back to the first range', () => {
    expect(usageRange('x').id).toBe('1h');
  });

  it('slices the points of the range up to now', () => {
    const points = [3, 2, 1, 0].map((hours) => ({ at: 10 * HOUR_MS - hours * HOUR_MS, utilization: hours, resetsAt: null }));
    expect(pointsInRange(points, usageRange('1h'), 10 * HOUR_MS).map((point) => point.utilization)).toEqual([1, 0]);
    expect(pointsInRange(points, usageRange('1h'), 9.5 * HOUR_MS).map((point) => point.utilization)).toEqual([1]);
  });
});
