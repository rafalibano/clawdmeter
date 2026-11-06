import { describe, expect, it } from 'vitest';
import { DROP_MARGIN, evaluateUsageAlert, normalizeQuartiles, type Quartile, type WindowAlertState } from './usage-alerts';

const RESETS = 1_800_000_000_000;
const reading = (utilization: number, resetsAt: number | null = RESETS) => ({ utilization, resetsAt });
const ALL: Quartile[] = [25, 50, 75, 100];

function run(readings: number[], selected: Quartile[] = ALL, resetsAt: number | null = RESETS) {
  let state: WindowAlertState | null = null;
  return readings.map((utilization) => {
    const outcome = evaluateUsageAlert(state, reading(utilization, resetsAt), selected);
    state = outcome.state;
    return outcome.alert;
  });
}

describe('evaluateUsageAlert', () => {
  it('does not alert on the first reading, whatever the utilization', () => {
    expect(run([80])).toEqual([null]);
    expect(run([100])).toEqual([null]);
  });

  it('alerts when a selected quartile is crossed after the first reading', () => {
    expect(run([10, 30, 60, 80, 100])).toEqual([null, 25, 50, 75, 100]);
  });

  it('crossing a quartile after a silent first reading still alerts the next one', () => {
    expect(run([60, 70, 76])).toEqual([null, null, 75]);
  });

  it('alerts each quartile only once per cycle', () => {
    expect(run([10, 30, 31, 35, 30, 36])).toEqual([null, 25, null, null, null, null]);
  });

  it('alerts only the highest selected quartile when several are crossed at once', () => {
    expect(run([10, 80])).toEqual([null, 75]);
    expect(run([10, 80], [25, 50])).toEqual([null, 50]);
  });

  it('ignores quartiles that are not selected', () => {
    expect(run([10, 30, 60, 80], [75])).toEqual([null, null, null, 75]);
  });

  it('an empty list never alerts', () => {
    expect(run([10, 30, 60, 80, 100], [])).toEqual([null, null, null, null, null]);
  });

  it('a quartile already passed while unselected is not alerted retroactively', () => {
    const first = evaluateUsageAlert(null, reading(10), [75]);
    const second = evaluateUsageAlert(first.state, reading(60), [75]);
    expect(evaluateUsageAlert(second.state, reading(62), [50, 75]).alert).toBeNull();
  });

  it('restarts the cycle when resetsAt changes and alerts again', () => {
    const first = evaluateUsageAlert(null, reading(10), [50]);
    const crossed = evaluateUsageAlert(first.state, reading(60), [50]);
    expect(crossed.alert).toBe(50);
    const next = evaluateUsageAlert(crossed.state, reading(60, RESETS + 5 * 3_600_000), [50]);
    expect(next.alert).toBe(50);
    expect(next.state.resetsAt).toBe(RESETS + 5 * 3_600_000);
  });

  it('tolerates sub-minute jitter in resetsAt without restarting the cycle', () => {
    const first = evaluateUsageAlert(null, reading(10), [50]);
    const crossed = evaluateUsageAlert(first.state, reading(60), [50]);
    expect(evaluateUsageAlert(crossed.state, reading(61, RESETS + 1_000), [50]).alert).toBeNull();
  });

  it('does not restart on resetsAt when either side is null', () => {
    const first = evaluateUsageAlert(null, reading(10, null), [50]);
    const crossed = evaluateUsageAlert(first.state, reading(60, null), [50]);
    expect(crossed.alert).toBe(50);
    expect(evaluateUsageAlert(crossed.state, reading(61, RESETS), [50]).alert).toBeNull();
  });

  it('restarts the cycle when utilization drops below the last quartile reached', () => {
    expect(run([10, 60, 5, 60])).toEqual([null, 50, null, 50]);
  });

  it('a drop that stays at or above the quartile is not a restart', () => {
    expect(run([10, 60, 51, 60])).toEqual([null, 50, null, null]);
  });

  it('a drop within the margin neither restarts nor alerts again', () => {
    expect(DROP_MARGIN).toBe(5);
    expect(run([10, 50, 49.9, 50, 49.9, 50], [50])).toEqual([null, 50, null, null, null, null]);
    expect(run([10, 50, 45, 50], [50])).toEqual([null, 50, null, null]);
  });

  it('a drop beyond the margin restarts silently and keeps the quartiles still above', () => {
    const marked = evaluateUsageAlert(evaluateUsageAlert(null, reading(10), [25]).state, reading(60), [25]);
    const dropped = evaluateUsageAlert(marked.state, reading(30), [25]);
    expect(dropped.alert).toBeNull();
    expect(dropped.state.reached).toBe(25);
    expect(run([10, 60, 30], [25])).toEqual([null, 25, null]);
    expect(run([10, 60, 30, 80], [25, 75])).toEqual([null, 25, null, 75]);
  });

  it('a drop below the first quartile restarts with nothing reached', () => {
    const marked = evaluateUsageAlert(evaluateUsageAlert(null, reading(10), [25]).state, reading(30), [25]);
    expect(evaluateUsageAlert(marked.state, reading(10), [25]).state.reached).toBe(0);
  });

  it('a drop beyond the margin restarts the cycle and alerts again when crossed again', () => {
    expect(run([10, 60, 5, 30, 60], [25, 50])).toEqual([null, 50, null, 25, 50]);
  });

  it('a drop from above 100 inside the margin does not alert', () => {
    expect(run([10, 120, 99])).toEqual([null, 100, null]);
  });

  it('utilization above 100 alerts the 100 quartile', () => {
    expect(run([10, 120])).toEqual([null, 100]);
  });

  it('resetsAt jitter is tolerated up to exactly 60 s and restarts beyond it', () => {
    const first = evaluateUsageAlert(null, reading(10), [50]);
    const crossed = evaluateUsageAlert(first.state, reading(60), [50]);
    expect(evaluateUsageAlert(crossed.state, reading(60, RESETS + 60_000), [50]).alert).toBeNull();
    expect(evaluateUsageAlert(crossed.state, reading(60, RESETS - 60_000), [50]).alert).toBeNull();
    expect(evaluateUsageAlert(crossed.state, reading(60, RESETS + 60_001), [50]).alert).toBe(50);
  });
});

describe('normalizeQuartiles', () => {
  it('sorts, deduplicates and drops invalid values', () => {
    expect(normalizeQuartiles([100, 25, 25, 10, '50', 75])).toEqual([25, 75, 100]);
    expect(normalizeQuartiles('x')).toEqual([]);
  });
});
