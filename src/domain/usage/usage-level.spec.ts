import { describe, expect, it } from 'vitest';
import { HOUR_MS, MINUTE_MS } from '../time';
import type { UsagePoint } from './usage-history';
import { LEVEL_GAP_MS, levelAt, levelSteps } from './usage-level';
import { RESET_JITTER_MS } from './usage-window';

const NOW = 1_800_000_000_000;
const FROM = NOW - 6 * HOUR_MS;

describe('levelAt', () => {
  it('keeps the reading until its reset and is zero from the reset on, tolerating the reset jitter', () => {
    const point: UsagePoint = { at: 0, utilization: 40, resetsAt: HOUR_MS };
    expect(levelAt(point, HOUR_MS - RESET_JITTER_MS - 1)).toBe(40);
    expect(levelAt(point, HOUR_MS - RESET_JITTER_MS)).toBe(0);
    expect(levelAt(point, HOUR_MS)).toBe(0);
    expect(levelAt({ ...point, resetsAt: null }, 1e15)).toBe(40);
  });
});

describe('levelSteps', () => {
  it('without any point there is nothing to draw', () => {
    expect(levelSteps([], FROM, NOW)).toEqual([]);
  });

  it('without a point before the range nothing is carried in', () => {
    expect(levelSteps([{ at: NOW - HOUR_MS, utilization: 7, resetsAt: null }], FROM, NOW)).toEqual([[NOW, 7]]);
  });

  it('carries the last reading before the range from its start up to now', () => {
    const points: UsagePoint[] = [{ at: FROM - 3 * HOUR_MS, utilization: 35, resetsAt: NOW + 3 * HOUR_MS }];
    expect(levelSteps(points, FROM, NOW)).toEqual([
      [FROM, 35],
      [NOW, 35],
    ]);
  });

  it('a reset already past at the start of the range carries the post-reset level', () => {
    const points: UsagePoint[] = [{ at: FROM - 3 * HOUR_MS, utilization: 64, resetsAt: FROM - HOUR_MS }];
    expect(levelSteps(points, FROM, NOW)).toEqual([
      [FROM, 0],
      [NOW, 0],
    ]);
  });

  it('a reset a fraction of a second after the start of the range counts as already passed', () => {
    const points: UsagePoint[] = [{ at: FROM - 3 * HOUR_MS, utilization: 92, resetsAt: FROM + 500 }];
    expect(levelSteps(points, FROM, NOW)).toEqual([
      [FROM, 0],
      [NOW, 0],
    ]);
  });

  it('a reading whose reset is a fraction of a second stale drops to zero right after it', () => {
    const at = FROM + HOUR_MS;
    const points: UsagePoint[] = [{ at, utilization: 30, resetsAt: at - 400 }];
    expect(levelSteps(points, FROM, NOW)).toEqual([
      [at, 30],
      [at, 0],
      [NOW, 0],
    ]);
  });

  it('a reset inside the range drops the level to zero at the reset', () => {
    const resetsAt = FROM + 2 * HOUR_MS;
    const points: UsagePoint[] = [{ at: FROM - HOUR_MS, utilization: 64, resetsAt }];
    expect(levelSteps(points, FROM, NOW)).toEqual([
      [FROM, 64],
      [resetsAt, 64],
      [resetsAt, 0],
      [NOW, 0],
    ]);
  });

  it('holds the carried level until the first reading inside the range', () => {
    const first = NOW - 15 * MINUTE_MS;
    const points: UsagePoint[] = [
      { at: FROM - HOUR_MS, utilization: 3, resetsAt: null },
      { at: first, utilization: 5, resetsAt: null },
      { at: NOW, utilization: 5, resetsAt: null },
    ];
    expect(levelSteps(points, FROM, NOW)).toEqual([
      [FROM, 3],
      [first - 1, 3],
    ]);
  });

  it('holds across long gaps between readings, respecting a reset in the gap, and extends the last reading only up to the end of the range', () => {
    const points: UsagePoint[] = [
      { at: FROM, utilization: 60, resetsAt: FROM + HOUR_MS },
      { at: FROM + 4 * HOUR_MS, utilization: 9, resetsAt: NOW + 3 * HOUR_MS },
      { at: FROM + 4 * HOUR_MS + LEVEL_GAP_MS, utilization: 10, resetsAt: NOW + 3 * HOUR_MS },
    ];
    expect(levelSteps(points, FROM, NOW)).toEqual([
      [FROM + HOUR_MS, 60],
      [FROM + HOUR_MS, 0],
      [FROM + 4 * HOUR_MS - 1, 0],
      [NOW, 10],
    ]);
    expect(levelSteps(points, FROM, FROM + 4 * HOUR_MS + LEVEL_GAP_MS).at(-1)).toEqual([FROM + 4 * HOUR_MS - 1, 0]);
  });

  it('the minimum gap can only grow beyond the default', () => {
    const points: UsagePoint[] = [
      { at: FROM, utilization: 1, resetsAt: null },
      { at: FROM + HOUR_MS, utilization: 2, resetsAt: null },
    ];
    expect(levelSteps(points, FROM, FROM + HOUR_MS)).toEqual([[FROM + HOUR_MS - 1, 1]]);
    expect(levelSteps(points, FROM, FROM + HOUR_MS, 2 * HOUR_MS)).toEqual([]);
    expect(levelSteps(points, FROM, FROM + HOUR_MS, MINUTE_MS)).toEqual([[FROM + HOUR_MS - 1, 1]]);
  });
});
