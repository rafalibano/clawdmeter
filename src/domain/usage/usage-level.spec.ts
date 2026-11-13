import { describe, expect, it } from 'vitest';
import { HOUR_MS, MINUTE_MS } from '../time';
import type { UsagePoint } from './usage-history';
import { LEVEL_GAP_MS, SMOOTH_HOLD_GAP_MS, levelAt, levelSteps, smoothLevelSteps } from './usage-level';
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

describe('smoothLevelSteps', () => {
  const reading = (at: number, utilization: number, resetsAt: number | null = null): UsagePoint => ({ at, utilization, resetsAt });

  it('without any point there is nothing to draw', () => {
    expect(smoothLevelSteps([], FROM, NOW)).toEqual([]);
  });

  it('adds no hold between readings closer than the smooth gap, where the stepped mode would', () => {
    const to = FROM + 2 * HOUR_MS;
    const points = [reading(FROM, 10), reading(FROM + HOUR_MS, 20), reading(to - MINUTE_MS, 30)];
    expect(levelSteps(points, FROM, to)).toContainEqual([FROM + HOUR_MS - 1, 10]);
    expect(smoothLevelSteps(points, FROM, to)).toEqual([]);
  });

  it('holds across a gap longer than the smooth gap, up to just before the next reading', () => {
    const points = [reading(FROM, 10), reading(FROM + SMOOTH_HOLD_GAP_MS + MINUTE_MS, 20), reading(NOW - MINUTE_MS, 30)];
    expect(smoothLevelSteps(points, FROM, NOW)).toEqual([[FROM + SMOOTH_HOLD_GAP_MS + MINUTE_MS - 1, 10]]);
  });

  it('a reset between close readings still drops straight down, with no hold', () => {
    const resetsAt = FROM + 30 * MINUTE_MS;
    const to = FROM + 2 * HOUR_MS;
    const points = [reading(FROM, 80, resetsAt), reading(FROM + HOUR_MS, 3), reading(to - MINUTE_MS, 4)];
    expect(smoothLevelSteps(points, FROM, to)).toEqual([
      [resetsAt, 80],
      [resetsAt, 0],
    ]);
  });

  it('a reset inside a long gap drops and holds the post-reset level until the next reading', () => {
    const resetsAt = FROM + HOUR_MS;
    const next = FROM + 5 * HOUR_MS;
    const points = [reading(FROM, 60, resetsAt), reading(next, 9), reading(NOW - MINUTE_MS, 10)];
    expect(smoothLevelSteps(points, FROM, NOW)).toEqual([
      [resetsAt, 60],
      [resetsAt, 0],
      [next - 1, 0],
    ]);
  });

  it('extends the last reading up to the end of the range with the stepped gap and never beyond it', () => {
    const points = [reading(NOW - 2 * HOUR_MS, 10), reading(NOW - HOUR_MS, 40)];
    expect(smoothLevelSteps(points, FROM, NOW)).toEqual([[NOW, 40]]);
    expect(smoothLevelSteps([reading(NOW - 2 * HOUR_MS, 10), reading(NOW - 5 * MINUTE_MS, 40)], FROM, NOW)).toEqual([]);
  });

  it('carries the last reading before the range into its start, like the stepped mode', () => {
    const points = [reading(FROM - 3 * HOUR_MS, 35, NOW + 3 * HOUR_MS)];
    expect(smoothLevelSteps(points, FROM, NOW)).toEqual(levelSteps(points, FROM, NOW));
    const dropped = [reading(FROM - 3 * HOUR_MS, 64, FROM - HOUR_MS)];
    expect(smoothLevelSteps(dropped, FROM, NOW)).toEqual([
      [FROM, 0],
      [NOW, 0],
    ]);
  });

  it('the minimum gap only widens the trailing hold', () => {
    const points = [reading(NOW - 2 * HOUR_MS, 10), reading(NOW - HOUR_MS, 40)];
    expect(smoothLevelSteps(points, FROM, NOW, 2 * HOUR_MS)).toEqual([]);
  });
});
