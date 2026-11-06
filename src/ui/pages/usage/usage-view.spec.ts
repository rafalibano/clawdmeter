import { describe, expect, it } from 'vitest';
import { ProjectUsage, type UsageData } from '../../../application/use-cases';
import { actionsFor, claudeSignInStatus, errorStatus } from '../../../domain/connections';
import { HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { createEmptyHistory, type Forecast, type ProjectionMethod, type UsageHistory } from '../../../domain/usage';
import { toRowView } from '../../settings/connections/connection-view';
import { Localizer } from '../../i18n';
import {
  activeUsageData,
  projectionOf as projectionWith,
  resetText as resetTextWith,
  toUsageErrorView,
  toUsageView as toUsageViewWith,
} from './usage-view';

const PT = new Localizer('pt-BR');
const projectionOf = (forecast: Forecast, current: number, l = PT) => projectionWith(forecast, current, l);
const resetText = (resetsAt: number | null, now: number, l = PT) => resetTextWith(resetsAt, now, l);
const toUsageView = (data: UsageData, rangeId: string, method: ProjectionMethod = '14d', l = PT) =>
  toUsageViewWith(data, rangeId, l, method);

const NOW = new Date(2026, 10, 5, 14, 0).getTime();
const RESET = new Date(2026, 10, 5, 16, 6).getTime();

function dataWith(history: UsageHistory, fiveHour = 40): UsageData {
  const snapshot = {
    fiveHour: { utilization: fiveHour, resetsAt: RESET },
    sevenDay: { utilization: 12.4, resetsAt: NOW + 6 * 24 * HOUR_MS + 2 * HOUR_MS },
  };
  return { accountId: 'account-1', at: NOW, snapshot, history };
}

function ramp(valueAt: (index: number) => number): UsageHistory {
  const points = Array.from({ length: 31 }, (_, index) => ({
    at: NOW - (30 - index) * 2 * MINUTE_MS,
    utilization: valueAt(index),
    resetsAt: RESET,
  }));
  return { fiveHour: points, sevenDay: [] };
}

const ready = (valueAtReset: number): Forecast => ({
  status: 'ready',
  resetsAt: RESET,
  ratePerDay: 0,
  valueAtReset,
  trend: { fromAt: NOW, fromValue: 40, toAt: RESET, toValue: valueAtReset },
  exhaustsAt: valueAtReset >= 100 ? NOW + HOUR_MS : null,
  exhaustsLeadMs: valueAtReset >= 100 ? RESET - NOW - HOUR_MS : null,
});

describe('resetText', () => {
  it('formats the short remaining time, without a clock time', () => {
    expect(resetText(RESET, NOW)).toBe('reseta em 2h06');
    expect(resetText(NOW + 6 * 24 * HOUR_MS + 2 * HOUR_MS, NOW)).toBe('reseta em 6d2h');
  });

  it('without a window, and a window that is past its reset', () => {
    expect(resetText(null, NOW)).toBe('sem janela ativa');
    expect(resetText(NOW - MINUTE_MS, NOW)).toBe('reseta agora');
  });
});

describe('projectionOf', () => {
  it('without a ready forecast there is no mark', () => {
    expect(projectionOf({ status: 'collecting' }, 40)).toBeNull();
    expect(projectionOf({ status: 'unavailable' }, 40)).toBeNull();
  });

  it('below 100%: a vertical line at the projected percentage', () => {
    expect(projectionOf(ready(78.4), 40)).toEqual({
      at: 78.4,
      exhausts: false,
      alert: false,
      label: 'Projetado 78%',
    });
  });

  it('overflow: the line sits at the end of the bar, in red, and the legend shows the real number', () => {
    expect(projectionOf(ready(132), 40)).toEqual({
      at: 100,
      exhausts: true,
      alert: true,
      label: 'Projetado 132%',
    });
    expect(projectionOf(ready(100), 100)).toMatchObject({ at: 100, exhausts: true, alert: true, label: 'Projetado 100%' });
    expect(projectionOf(ready(160), 40)!.label).not.toContain('>');
  });

  it('never drops below the current value', () => {
    expect(projectionOf(ready(30), 40)).toMatchObject({ at: 40, exhausts: false, label: 'Projetado 40%' });
  });

  it('the legend follows the language', () => {
    expect(projectionOf(ready(132), 40, new Localizer('en'))!.label).toBe('Projected 132%');
    expect(projectionOf(ready(132), 40, new Localizer('es-MX'))!.label).toBe('Proyectado 132%');
  });
});

describe('projection alert', () => {
  it('only the text alerts, from 100% projected', () => {
    expect(projectionOf(ready(99.9), 10)!.alert).toBe(false);
    expect(projectionOf(ready(100), 10)!.alert).toBe(true);
    expect(projectionOf(ready(132), 10)!.alert).toBe(true);
  });

  it('without a projection the bar has no legend', () => {
    const data = dataWith(createEmptyHistory());
    const idle = { fiveHour: { utilization: 40, resetsAt: null }, sevenDay: { utilization: 12, resetsAt: null } };
    const { bars } = toUsageView({ ...data, snapshot: idle }, '1d');
    expect(bars.every((bar) => bar.projection === null)).toBe(true);
  });
});

describe('projection method in the bars and in the chart', () => {
  const DAY = 24 * HOUR_MS;
  const weekly = (): UsageHistory => ({
    fiveHour: [],
    sevenDay: [
      { at: NOW - 4 * DAY, utilization: 2, resetsAt: null },
      { at: NOW - 2 * DAY, utilization: 8, resetsAt: null },
      { at: NOW, utilization: 12.4, resetsAt: null },
    ],
  });

  it('changing the method changes the 7d projection in the bars and chart, and 5h does not change', () => {
    const byDays = toUsageView(dataWith(weekly()), '7d', '14d');
    const bySince = toUsageView(dataWith(weekly()), '7d', 'since-reset');
    expect(byDays.bars[1]!.projection!.label).not.toBe(bySince.bars[1]!.projection!.label);
    expect(byDays.chart.windows[1]!.trend![1]![1]).not.toBe(bySince.chart.windows[1]!.trend![1]![1]);
    expect(byDays.bars[0]!.projection).toEqual(bySince.bars[0]!.projection);
    expect(byDays.chart.windows[0]!.trend).toEqual(bySince.chart.windows[0]!.trend);
  });

  it('the same rule holds in every period and in the Cycle (same line slope)', () => {
    const slope = (range: string, method: ProjectionMethod) => {
      const trend = toUsageView(dataWith(weekly()), range, method).chart.windows[1]!.trend!;
      return ((trend[1]![1] - trend[0]![1]) / (trend[1]![0] - trend[0]![0])) * DAY;
    };
    for (const range of ['7d', '30d', 'cycle']) {
      expect(slope(range, '14d')).toBeCloseTo(((8 - 2 + (12.4 - 8)) / 4), 5);
      expect(slope(range, 'since-reset')).toBeCloseTo((12.4 / 22) * 24, 5);
    }
  });
});

describe('consistency: a single projection for bar, line and tooltip', () => {
  const DAY = 24 * HOUR_MS;
  const history = (): UsageHistory => ({
    fiveHour: [],
    sevenDay: [
      { at: NOW - 4 * DAY, utilization: 2, resetsAt: null },
      { at: NOW - 2 * DAY, utilization: 8, resetsAt: null },
      { at: NOW - 20 * HOUR_MS, utilization: 9, resetsAt: null },
      { at: NOW - 10 * HOUR_MS, utilization: 11.5, resetsAt: null },
      { at: NOW, utilization: 12.4, resetsAt: null },
    ],
  });

  for (const method of ['24h', '7d', '14d', 'since-reset'] as const) {
    it(`${method}: the last point of the line at reset (Cycle, no cap) is the bar's valueAtReset`, () => {
      const data = dataWith(history());
      const forecasts = new ProjectUsage().execute(data.history, data.snapshot, data.at, method);
      const weekly = forecasts.sevenDay;
      if (weekly.status !== 'ready') throw new Error('expected a ready projection');
      const view = toUsageView(data, 'cycle', method);
      const trend = view.chart.windows[1]!.trend!;
      expect(trend[1]![0]).toBe(weekly.resetsAt);
      expect(trend[1]![1]).toBeCloseTo(weekly.valueAtReset, 9);
      expect(view.chart.windows[1]!.projectAt!(weekly.resetsAt)).toBeCloseTo(weekly.valueAtReset, 9);
      expect(view.bars[1]!.projection!.label).toBe(`Projetado ${Math.round(Math.max(weekly.valueAtReset, 12.4))}%`);
      expect(Math.round(trend[1]![1])).toBe(Math.round(weekly.valueAtReset));
      expect(trend[1]![1] - trend[0]![1]).toBeCloseTo((weekly.ratePerDay * (weekly.resetsAt - NOW)) / DAY, 9);
    });

    it(`${method}: 5h in the bar and in the line also come from the same projection`, () => {
      const data = dataWith(history());
      const five = new ProjectUsage().execute(data.history, data.snapshot, data.at, method).fiveHour;
      if (five.status !== 'ready') throw new Error('expected a ready projection');
      const view = toUsageView(data, '6h', method);
      const trend = view.chart.windows[0]!.trend!;
      expect(view.bars[0]!.projection!.label).toBe(`Projetado ${Math.round(Math.max(five.valueAtReset, 40))}%`);
      expect(trend[0]).toEqual([NOW, 40]);
      expect(five.valueAtReset).toBeGreaterThan(40);
    });
  }

  it('the four methods give different 7d projections, but 5h is the same', () => {
    const data = dataWith(history());
    const run = (method: ProjectionMethod) => new ProjectUsage().execute(data.history, data.snapshot, data.at, method);
    const values = (['24h', '7d', '14d', 'since-reset'] as const).map((method) => {
      const weekly = run(method).sevenDay;
      return weekly.status === 'ready' ? weekly.valueAtReset : null;
    });
    expect(new Set(values).size).toBe(4);
    expect(values).not.toContain(null);
    expect(run('24h').fiveHour).toEqual(run('7d').fiveHour);
    expect(run('7d').fiveHour).toEqual(run('14d').fiveHour);
    expect(run('14d').fiveHour).toEqual(run('since-reset').fiveHour);
  });
});

describe('toUsageView', () => {
  it('builds the two bars with percentage, short reset and projected segment only where there is a forecast', () => {
    const { bars } = toUsageView(dataWith(ramp((i) => 10 + i)), '6h');
    expect(bars.map((bar) => bar.label)).toEqual(['5h', '7d']);
    expect(bars[0]).toMatchObject({ kind: 'fiveHour', percent: '40%', fill: 40, reset: 'reseta em 2h06' });
    expect(bars[0]!.projection).not.toBeNull();
    expect(bars[1]).toMatchObject({ kind: 'sevenDay', percent: '12%', reset: 'reseta em 6d2h' });
    expect(bars[1]!.projection).not.toBeNull();
  });

  it('a single chart, with both windows on the same time axis', () => {
    const { chart } = toUsageView(dataWith(ramp((i) => 10 + i)), '6h');
    expect(chart.windows.map((window) => window.label)).toEqual(['5h', '7d']);
    expect(chart.xMin).toBe(NOW - 6 * HOUR_MS);
    const last = chart.windows[0]!.points[chart.windows[0]!.points.length - 1]!;
    const trendStart = chart.windows[0]!.trend![0]![0];
    expect(trendStart).toBeGreaterThanOrEqual(last[0]);
    expect(trendStart - last[0]).toBeLessThan((6 * HOUR_MS) / 120);
    expect(chart.windows[1]!.trend).not.toBeNull();
  });

  it('the chosen period slices the series', () => {
    const history = ramp((i) => 10 + i);
    const hour = toUsageView(dataWith(history), '1h').chart;
    const day = toUsageView(dataWith(history), '1d').chart;
    expect(hour.windows[0]!.points[0]![0]).toBeGreaterThanOrEqual(NOW - HOUR_MS);
    expect(day.xMax).toBeGreaterThan(hour.xMax);
  });

  it('window missing from the response: empty bar, no text', () => {
    const data = dataWith(createEmptyHistory());
    const { bars } = toUsageView({ ...data, snapshot: { fiveHour: null, sevenDay: null } }, '1d');
    expect(bars[0]).toEqual({ kind: 'fiveHour', label: '5h', percent: '—', fill: 0, reset: '', projection: null });
  });

  it('the Reset selector is only available with a known weekly reset', () => {
    const data = dataWith(createEmptyHistory());
    expect(toUsageView(data, 'cycle').cycleAvailable).toBe(true);
    const unknown = { ...data, snapshot: { ...data.snapshot, sevenDay: { utilization: 12, resetsAt: null } } };
    expect(toUsageView(unknown, 'cycle').cycleAvailable).toBe(false);
    expect(toUsageView({ ...data, snapshot: { fiveHour: null, sevenDay: null } }, 'cycle').cycleAvailable).toBe(false);
  });

  it('the Reset period builds the axis from the last weekly reset to the next one', () => {
    const { chart } = toUsageView(dataWith(ramp((i) => 10 + i)), 'cycle');
    const weeklyReset = NOW + 6 * 24 * HOUR_MS + 2 * HOUR_MS;
    expect(chart).toMatchObject({ cycle: true, xMin: weeklyReset - 7 * 24 * HOUR_MS, xMax: weeklyReset });
  });

  it('percentage above 100 fills the bar without passing the track', () => {
    const data = dataWith(createEmptyHistory(), 130);
    expect(toUsageView(data, '1d').bars[0]).toMatchObject({ percent: '130%', fill: 100 });
  });
});

describe('toUsageErrorView', () => {
  it('sign-in required: shows the account in the message and the "Sign in again" button', () => {
    const status = claudeSignInStatus('Trabalho');
    const row = toRowView('claude', status, PT);
    const view = toUsageErrorView('claude-signin-required', row);
    expect(view.message).toBe('Entre de novo na conta Trabalho.');
    expect(view.actions.map((action) => action.label)).toEqual(['reauthenticate-claude', 'recheck']);
    expect(actionsFor('claude', status).some((action) => action.kind === 'disconnect')).toBe(true);
    expect(view.actions.some((action) => action.kind === 'disconnect')).toBe(false);
  });

  it('no account: tells to add one and offers "Add account"', () => {
    const view = toUsageErrorView('claude-no-account', toRowView('claude', errorStatus('claude-no-account'), PT));
    expect(view.message).toBe('Nenhuma conta do Claude ainda. Adicione uma em Ajustes > Contas do Claude.');
    expect(view.actions.map((action) => action.label)).toEqual(['add-claude-account', 'recheck']);
  });

  it('disconnected: offers Connect', () => {
    const view = toUsageErrorView('Claude desconectado.', toRowView('claude', { state: 'disconnected' }, PT));
    expect(view.actions.map((action) => action.label)).toEqual(['connect']);
  });

  it('network error with the connection ok: only the message, no button', () => {
    const view = toUsageErrorView('Anthropic respondeu 500', toRowView('claude', { state: 'connected' }, PT));
    expect(view).toEqual({ message: 'Anthropic respondeu 500', actions: [] });
    expect(toUsageErrorView('x', undefined)).toEqual({ message: 'x', actions: [] });
  });
});

describe('activeUsageData', () => {
  const personal = dataWith(createEmptyHistory());
  const work = { ...personal, accountId: 'account-2' };

  it('shows the data of the active account, fresh or the last good one', () => {
    expect(activeUsageData({ pageId: 'usage', status: 'ok', data: personal, at: NOW }, undefined, 'account-1')).toBe(personal);
    const failed = { pageId: 'usage', status: 'error' as const, error: 'x', at: NOW };
    expect(activeUsageData(failed, personal, 'account-1')).toBe(personal);
  });

  it('ignores data of an account that is not the active one (shows loading instead)', () => {
    expect(activeUsageData({ pageId: 'usage', status: 'ok', data: personal, at: NOW }, personal, 'account-2')).toBeUndefined();
    expect(activeUsageData(undefined, personal, 'account-2')).toBeUndefined();
    expect(activeUsageData({ pageId: 'usage', status: 'ok', data: work, at: NOW }, personal, 'account-2')).toBe(work);
    expect(activeUsageData(undefined, personal, null)).toBeUndefined();
  });
});
