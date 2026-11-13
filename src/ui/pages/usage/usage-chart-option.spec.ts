import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { forecastWindow, parseHistory, usageRange, type Forecast, type ProjectionMethod, type UsagePoint } from '../../../domain/usage';
import { chartPalette } from '../../theme/chart-palette';
import { Localizer } from '../../i18n';
import { axisMaxFor, buildChartModel as buildModel, CYCLE_MS, CHART_BUCKETS, curveValueAt, downsample, FUTURE_SHARE, type WindowInput } from './usage-chart-model';
import { buildChartOption as buildOption, tooltipFormatter } from './usage-chart-option';

const PT = new Localizer('pt-BR');
const buildChartModel = buildModel;
const buildChartOption = (model: ReturnType<typeof buildChartModel>, palette: ReturnType<typeof chartPalette>, l = PT) =>
  buildOption(model, palette, l);

const NOW = 1_800_000_000_000;
const palette = chartPalette('#00b131', null, 'light');
const points = Array.from({ length: 10 }, (_, index) => ({
  at: NOW - (9 - index) * MINUTE_MS,
  utilization: 20 + index,
  resetsAt: NOW + 4 * HOUR_MS,
}));

const ready = (toValue: number, exhaustsAt: number | null = null): Forecast => ({
  status: 'ready',
  resetsAt: NOW + 4 * HOUR_MS,
  ratePerDay: 0,
  valueAtReset: toValue,
  trend: { fromAt: NOW, fromValue: 29, toAt: NOW + 4 * HOUR_MS, toValue },
  exhaustsAt,
  exhaustsLeadMs: exhaustsAt === null ? null : NOW + 4 * HOUR_MS - exhaustsAt,
});

const WEEKLY_RESET = NOW + 3 * 24 * HOUR_MS;
const withWeekly = (list: WindowInput[], method: ProjectionMethod = '14d'): WindowInput[] =>
  list.map((input) => {
    if (input.kind !== 'sevenDay') return input;
    const last = input.points[input.points.length - 1]!;
    return { ...input, forecast: forecastWindow('sevenDay', method, input.points, NOW, last.utilization, input.resetsAt) };
  });
const cycleInputs = (method: ProjectionMethod = '14d'): WindowInput[] => {
  const history: UsagePoint[] = [
    { at: NOW - 8 * 24 * HOUR_MS, utilization: 90, resetsAt: NOW - 8 * 24 * HOUR_MS + 5 * HOUR_MS },
    { at: NOW - 3 * 24 * HOUR_MS, utilization: 5, resetsAt: NOW - 3 * 24 * HOUR_MS + 5 * HOUR_MS },
    { at: NOW - 2 * 24 * HOUR_MS, utilization: 20, resetsAt: NOW - 2 * 24 * HOUR_MS + 5 * HOUR_MS },
    { at: NOW - HOUR_MS, utilization: 30, resetsAt: NOW + 4 * HOUR_MS },
  ];
  return withWeekly(
    [
      { kind: 'fiveHour', label: '5h', points: history, forecast: ready(60), resetsAt: NOW + 4 * HOUR_MS },
      { kind: 'sevenDay', label: '7d', points: history, forecast: ready(75), resetsAt: WEEKLY_RESET },
    ],
    method,
  );
};
const steepCycle = (factor: number): WindowInput[] =>
  withWeekly(
    cycleInputs().map((input) =>
      input.kind === 'sevenDay'
        ? { ...input, points: input.points.map((point) => ({ ...point, utilization: point.at < NOW - 4 * DAY_MS ? 0 : point.utilization * factor })) }
        : input,
    ),
  );

function inputs(forecast: Forecast, weekly: Forecast = { status: 'collecting' }): WindowInput[] {
  return [
    { kind: 'fiveHour', label: '5h', points, forecast, resetsAt: NOW + 4 * HOUR_MS },
    {
      kind: 'sevenDay',
      label: '7d',
      points: points.map((point) => ({ ...point, utilization: 50 })),
      forecast: weekly,
      resetsAt: NOW + 3 * 24 * HOUR_MS,
    },
  ];
}

describe('buildChartModel', () => {
  it('axis goes from now - period to now + room for the trend', () => {
    const model = buildChartModel(inputs({ status: 'collecting' }), usageRange('1h'), NOW);
    expect(model.xMin).toBe(NOW - HOUR_MS);
    expect(model.xMax).toBe(NOW + HOUR_MS * FUTURE_SHARE);
    expect(model.windows.map((window) => window.points.length)).toEqual([10, 10]);
    expect(model.windows[0]!.trend).toBeNull();
  });

  it('trend is cut at the axis edge and interpolated', () => {
    const model = buildChartModel(inputs(ready(69)), usageRange('1h'), NOW);
    const trend = model.windows[0]!.trend;
    expect(trend?.[0]).toEqual([NOW, 29]);
    expect(trend?.[1]?.[0]).toBe(model.xMax);
    expect(trend?.[1]?.[1]).toBeCloseTo(29 + (40 * HOUR_MS * FUTURE_SHARE) / (4 * HOUR_MS), 5);
  });

  it('outside the Cycle the trend ends where it crosses 100%', () => {
    for (const id of ['1h', '6h', '1d', '7d', '30d'] as const) {
      const model = buildChartModel(inputs(ready(5000), ready(5000)), usageRange(id), NOW);
      const end = model.windows[id === '7d' || id === '30d' ? 1 : 0]!.trend![1]!;
      expect(end[1]).toBe(100);
      expect(end[0]).toBeLessThan(model.xMax);
      expect(model.yMax).toBe(100);
    }
  });

  it('in the Cycle the trend goes past 100% and ends where it crosses 300%', () => {
    const model = buildChartModel(steepCycle(40), usageRange('cycle'), NOW);
    const end = model.windows[1]!.trend![1]!;
    expect(end[1]).toBe(300);
    expect(model.yMax).toBe(300);
  });

  it('reset before the edge: the trend ends at the reset', () => {
    const forecast = ready(40);
    const near = { ...forecast, trend: { ...(forecast as { trend: object }).trend, toAt: NOW + 5 * MINUTE_MS, toValue: 31 } } as Forecast;
    expect(buildChartModel(inputs(near), usageRange('1d'), NOW).windows[0]!.trend?.[1]).toEqual([NOW + 5 * MINUTE_MS, 31]);
  });
});

describe('y axis scale', () => {
  it('without a projection above 100% the axis is 0–100', () => {
    expect(axisMaxFor([])).toBe(100);
    expect(axisMaxFor([40, 100])).toBe(100);
    expect(buildChartModel(inputs(ready(60), ready(70)), usageRange('1h'), NOW).yMax).toBe(100);
  });

  it('above 100% it rises to the next multiple of 50 above the maximum', () => {
    expect(axisMaxFor([100.5])).toBe(150);
    expect(axisMaxFor([130])).toBe(150);
    expect(axisMaxFor([155])).toBe(200);
    expect(axisMaxFor([260])).toBe(300);
    expect(axisMaxFor([275])).toBe(300);
  });

  it('the step is 50 and every label is a multiple of 50 when expanded', () => {
    const option = buildChartOption(buildChartModel(steepCycle(4), usageRange('cycle'), NOW), palette) as { yAxis: { max: number; interval: number } };
    expect(option.yAxis.interval).toBe(50);
    expect(option.yAxis.max % 50).toBe(0);
  });

  it('the ceiling is 300%', () => {
    expect(axisMaxFor([299])).toBe(300);
    expect(axisMaxFor([900])).toBe(300);
  });

  it('the maximum comes from the drawn part of the trend, only in the Cycle', () => {
    expect(buildChartModel(steepCycle(4), usageRange('cycle'), NOW).yMax).toBeGreaterThan(100);
    expect(buildChartModel(inputs(ready(600)), usageRange('6h'), NOW).yMax).toBe(100);
  });
});

describe('buildChartOption', () => {
  const model = buildChartModel(inputs(ready(60), ready(70)), usageRange('1h'), NOW);
  const option = buildChartOption(model, palette) as unknown as {
    xAxis: { min: number; max: number; axisLine: { show: boolean }; axisLabel: { formatter: (value: number) => string } };
    yAxis: {
      min: number;
      max: number;
      interval: number;
      position: string;
      axisLine: { show: boolean };
      splitLine: { lineStyle: { color: string; type: string } };
    };
    tooltip: { backgroundColor: string };
    visualMap?: unknown;
    textStyle: { fontFamily: string };
    series: {
      name: string;
      smooth?: boolean | number;
      data: number[][];
      lineStyle: { color: string; type?: string; width: number };
      areaStyle?: { color: { type: string; colorStops: { offset: number; color: string }[] } };
      markLine?: { data: { xAxis?: number; yAxis?: number; lineStyle: { color: string; type: string } }[] };
    }[];
  };

  it('y axis on the right from 0 to 100 in steps of 25, no strong line, light dashed grid', () => {
    expect(option.yAxis).toMatchObject({ min: 0, max: 100, interval: 25, position: 'right' });
    expect(option.xAxis.axisLine.show).toBe(false);
    expect(option.yAxis.axisLine.show).toBe(false);
    expect(option.yAxis.splitLine.lineStyle).toMatchObject({ color: 'rgba(18, 18, 18, 0.06)', type: 'dashed' });
  });

  it('two smooth series (5h and 7d) and a thinner dashed trend per series with a forecast', () => {
    expect(option.series.map((series) => series.name)).toEqual(['5h', '7d', '5h tendência', '7d tendência']);
    const en = buildChartOption(model, palette, new Localizer('en')) as unknown as typeof option;
    expect(en.series.map((series) => series.name)).toEqual(['5h', '7d', '5h trend', '7d trend']);
    expect(option.series[0]!.smooth).toBe(0.5);
    expect(option.series[2]!.lineStyle).toMatchObject({ type: 'dashed', width: 1.2 });
    expect(option.series[2]!.lineStyle.width).toBeLessThan(option.series[0]!.lineStyle.width);
    expect(option.series[2]!.data[0]).toEqual([NOW, 29]);
  });

  it('5h in Mottu green and 7d in neutral gray, with a very light area', () => {
    expect(option.series[0]!.lineStyle.color).toBe('#00b131');
    expect(option.series[1]!.lineStyle.color).toBe('#767676');
    expect(option.series[2]!.lineStyle.color).toBe('#00b131');
    expect(option.series[0]!.areaStyle?.color.colorStops).toEqual([
      { offset: 0, color: 'rgba(0, 177, 49, 0.1)' },
      { offset: 1, color: 'rgba(0, 177, 49, 0)' },
    ]);
    const dark = buildChartOption(model, chartPalette('#00b131', null, 'dark')) as unknown as typeof option;
    expect(dark.series[0]!.lineStyle.color).toBe('#1bd60b');
    expect(dark.series[1]!.lineStyle.color).toBe('#a9a9a9');
  });

  it('chosen colors apply to the real line, the area, the dashed trend and the tooltip', () => {
    const custom = chartPalette('#00b131', null, 'dark', { fiveHour: '#0063f7', sevenDay: '#ef6800' });
    const out = buildChartOption(model, custom) as unknown as typeof option;
    expect(out.series[0]!.lineStyle.color).toBe('#0063f7');
    expect(out.series[1]!.lineStyle.color).toBe('#ef6800');
    expect(out.series[2]!.lineStyle.color).toBe('#0063f7');
    expect(out.series[3]!.lineStyle.color).toBe('#ef6800');
    expect(out.series[0]!.areaStyle?.color.colorStops[0]).toEqual({ offset: 0, color: 'rgba(0, 99, 247, 0.1)' });
    const at = model.windows[0]!.points[0]![0];
    const text = tooltipFormatter(model, custom, PT)([{ axisValue: at }]);
    expect(text).toContain('background-color:#0063f7');
    expect(text).toContain('background-color:#ef6800');
  });

  it('marks: no 100% line when the axis is 0–100, only "now" and the resets inside the axis', () => {
    const marks = option.series[0]!.markLine!.data;
    expect(marks.some((mark) => mark.yAxis !== undefined)).toBe(false);
    expect(marks.some((mark) => mark.xAxis === NOW)).toBe(true);
    expect(marks.filter((mark) => mark.xAxis !== undefined && mark.xAxis > NOW)).toHaveLength(0);
    const wide = buildChartOption(buildChartModel(inputs(ready(60)), usageRange('30d'), NOW), palette) as unknown as typeof option;
    const resets = wide.series[0]!.markLine!.data.filter((mark) => mark.xAxis !== undefined && mark.xAxis > NOW);
    expect(resets.map((mark) => mark.xAxis)).toEqual([NOW + 4 * HOUR_MS, NOW + 3 * 24 * HOUR_MS]);
  });

  describe('expanded axis (Cycle only)', () => {
    const cycleOption = (factor: number) =>
      buildChartOption(buildChartModel(steepCycle(factor), usageRange('cycle'), NOW), palette) as unknown as typeof option & {
        yAxis: { max: number; interval: number; axisLabel: { formatter: (value: number) => string } };
      };
    const expanded = cycleOption(4);

    it('the y axis goes past 100% and the 100% label is highlighted', () => {
      expect(expanded.yAxis.max).toBeGreaterThan(100);
      expect(expanded.yAxis.axisLabel.formatter(100)).toBe('{reference|100%}');
      expect(expanded.yAxis.axisLabel.formatter(50)).toBe('50%');
    });

    it('solid, subtle reference line at 100%', () => {
      const reference = expanded.series[0]!.markLine!.data.filter((mark) => mark.yAxis !== undefined);
      expect(reference).toHaveLength(1);
      expect(reference[0]).toMatchObject({ yAxis: 100, lineStyle: { type: 'solid', width: 1, color: 'rgba(255, 84, 73, 0.4)' } });
    });

    it('with a 300% ceiling the axis step is 50', () => {
      expect(cycleOption(40).yAxis).toMatchObject({ max: 300, interval: 50 });
    });

    it('outside the Cycle the axis is 0–100, with no highlighted line or label', () => {
      for (const id of ['1h', '6h', '1d', '7d', '30d'] as const) {
        const plain = buildChartOption(buildChartModel(inputs(ready(600)), usageRange(id), NOW), palette) as unknown as typeof expanded;
        expect(plain.yAxis).toMatchObject({ min: 0, max: 100, interval: 25 });
        expect(plain.yAxis.axisLabel.formatter(100)).toBe('100%');
        expect(plain.series[0]!.markLine!.data.some((mark) => mark.yAxis !== undefined)).toBe(false);
      }
    });
  });

  it('the 100% grid is the same soft line as the other levels', () => {
    expect(JSON.stringify(option)).not.toContain('rgba(255, 84, 73, 0.5)');
    expect(option.yAxis.splitLine.lineStyle).toMatchObject({ color: 'rgba(18, 18, 18, 0.06)', type: 'dashed' });
  });

  it('the real 7d series is always gray: there is no band visualMap', () => {
    expect(option.visualMap).toBeUndefined();
    const high = buildChartOption(
      buildChartModel(inputs(ready(60)).map((input) => ({ ...input, points: input.points.map((point) => ({ ...point, utilization: 95 })) })), usageRange('1h'), NOW),
      palette,
    ) as unknown as typeof option;
    expect(high.series[1]!.lineStyle.color).toBe('#767676');
  });

  it('the trend always has the series color, whatever the projected value', () => {
    const colors = (five: number, seven: number) => {
      const built = buildChartOption(buildChartModel(inputs(ready(five), ready(seven)), usageRange('1h'), NOW), palette) as unknown as typeof option;
      return [built.series[2]!.lineStyle.color, built.series[3]!.lineStyle.color];
    };
    for (const value of [50, 75, 95, 100, 160]) expect(colors(value, value)).toEqual(['#00b131', '#767676']);
  });

  it('5h stays green even without 7d in the trend', () => {
    const only = buildChartOption(buildChartModel(inputs(ready(60)), usageRange('1h'), NOW), palette) as unknown as typeof option;
    expect(only.series[0]!.lineStyle.color).toBe('#00b131');
    expect(only.series[2]!.lineStyle.color).toBe('#00b131');
  });

  it('in long periods the real line gets thinner, and the trend stays thinner than it', () => {
    const long = buildChartOption(buildChartModel(inputs(ready(60), ready(60)), usageRange('30d'), NOW), palette) as unknown as typeof option;
    expect(long.series[0]!.lineStyle.width).toBe(1.5);
    expect(long.series[2]!.lineStyle.width).toBeLessThan(1.5);
  });

  it('tooltip in the card color and Helvetica font', () => {
    expect(option.tooltip.backgroundColor).toBe('#ffffff');
    expect(option.textStyle.fontFamily).toBe('"Helvetica Neue", Helvetica, Arial, sans-serif');
  });

  it('without a forecast only the two real series are drawn', () => {
    const plain = buildChartOption(buildChartModel(inputs({ status: 'collecting' }), usageRange('1h'), NOW), palette) as unknown as {
      series: unknown[];
    };
    expect(plain.series).toHaveLength(2);
  });

  it('axis labels use local time in the short period and day/month in the long one', () => {
    expect(option.xAxis.axisLabel.formatter(NOW)).toMatch(/^\d{2}:\d{2}$/);
    const long = buildChartOption(buildChartModel(inputs({ status: 'collecting' }), usageRange('30d'), NOW), palette) as unknown as typeof option;
    expect(long.xAxis.axisLabel.formatter(NOW)).toMatch(/^\d{2}\/\d{2}$/);
  });
});

describe('Reset period (weekly cycle)', () => {
  it('axis goes from (weekly reset - 7d) to the weekly reset and only has points from that cycle', () => {
    const model = buildChartModel(cycleInputs(), usageRange('cycle'), NOW);
    expect(model).toMatchObject({ cycle: true, xMin: WEEKLY_RESET - CYCLE_MS, xMax: WEEKLY_RESET, rangeMs: CYCLE_MS });
    const window = model.windows[0]!;
    const values = window.points.map((point) => point[1]);
    expect(window.points.every((point) => point[0] >= model.xMin && point[0] <= NOW)).toBe(true);
    expect(Math.max(...values)).toBe(30);
    expect(values.includes(90)).toBe(false);
  });

  it('in Reset the 5h projection does not appear and the 7d one goes up to the weekly reset', () => {
    const model = buildChartModel(cycleInputs(), usageRange('cycle'), NOW);
    expect(model.windows[0]!.trend).toBeNull();
    expect(model.windows[1]!.trend?.[1]?.[0]).toBe(WEEKLY_RESET);
  });

  it('in Reset 7d uses the daily average of the last 14 days', () => {
    const model = buildChartModel(cycleInputs(), usageRange('cycle'), NOW);
    const span = (NOW - HOUR_MS - (NOW - 8 * 24 * HOUR_MS)) / DAY_MS;
    const rate = (15 + 10) / span;
    const trend = model.windows[1]!.trend!;
    expect(trend[0]).toEqual([NOW, 30]);
    expect(trend[1]![1]).toBeCloseTo(30 + rate * 3, 5);
  });

  it('without enough data it falls back to consumption since the reset', () => {
    const short = withWeekly(cycleInputs().map((input) => ({ ...input, points: input.points.filter((point) => point.at > NOW - 2 * HOUR_MS) })));
    const model = buildChartModel(short, usageRange('cycle'), NOW);
    expect(model.windows[1]!.trend![1]![1]).toBeCloseTo(30 + (30 / 4) * 3, 5);
  });

  it('regular periods keep the regression and the 5h projection', () => {
    const model1d = buildChartModel(cycleInputs(), usageRange('1d'), NOW);
    expect(model1d.windows[0]!.trend).not.toBeNull();
    expect(model1d.windows[1]!.trend).not.toBeNull();
  });

  it('7d and 30d only project 7d; 5h has no trend', () => {
    for (const id of ['7d', '30d']) {
      const model = buildChartModel(cycleInputs(), usageRange(id), NOW);
      expect(model.windows[0]!.trend).toBeNull();
      expect(model.windows[1]!.trend).not.toBeNull();
    }
    for (const id of ['1h', '6h', '1d']) {
      expect(buildChartModel(cycleInputs(), usageRange(id), NOW).windows[0]!.trend).not.toBeNull();
    }
  });

  describe('projection in Reset', () => {
    it('there are no daily dots, only the dashed line and the tooltip probe', () => {
      const built = buildChartModel(steepCycle(4), usageRange('cycle'), NOW);
      expect(built.yMax).toBeGreaterThan(100);
      const out = buildChartOption(built, palette, PT) as unknown as { series: { type: string }[] };
      expect(out.series.some((series) => series.type === 'scatter')).toBe(false);
    });

    it('live tooltip: in the future shows only the projection computed at that instant; in the past, the real values', () => {
      const built = buildChartModel(steepCycle(4), usageRange('cycle'), NOW);
      const format = tooltipFormatter(built, palette, PT);
      const project = built.windows[1]!.projectAt!;
      const mid = NOW + 30 * HOUR_MS + 17 * MINUTE_MS;
      const future = format([{ axisValue: mid, seriesIndex: 0, marker: '', seriesName: '5h', value: [NOW, 5] }]);
      expect(future).toBe(`${PT.weekday(mid)} ${PT.axisTick(mid, CYCLE_MS)} ${PT.clock(mid)}<br/><span style="display:inline-block;margin-right:4px;border-radius:50%;width:10px;height:10px;background-color:${palette.series.sevenDay.line}"></span>Projetado ${Math.round(project(mid))}%`);
      expect(future).not.toContain('5h');
      expect(project(mid)).toBeGreaterThan(project(NOW + HOUR_MS));
      const past = NOW - HOUR_MS;
      const curve = curveValueAt(built.windows[1]!.points, past)!;
      const text = format([{ axisValue: past }]);
      expect(text).toContain(`7d ${Math.round(curve)}%`);
      expect(text).not.toContain('Projetado');
    });
  });

  describe('history and smooth curve in buckets', () => {
    const mixed = (): UsagePoint[] => [
      { at: NOW - 20 * DAY_MS, utilization: 10, resetsAt: null, imported: true },
      { at: NOW - 6 * DAY_MS - 30 * MINUTE_MS, utilization: 12, resetsAt: null },
      { at: NOW - 6 * DAY_MS, utilization: 15, resetsAt: null, imported: true },
      { at: NOW - 5 * DAY_MS, utilization: 16, resetsAt: null },
      { at: NOW - 5 * DAY_MS + 10 * MINUTE_MS, utilization: 17, resetsAt: null },
      { at: NOW - HOUR_MS, utilization: 30, resetsAt: null },
      { at: NOW - 50 * MINUTE_MS, utilization: 31, resetsAt: null },
    ];
    const weekly = (id: string) =>
      buildChartModel([{ kind: 'sevenDay', label: '7d', points: mixed(), forecast: { status: 'collecting' }, resetsAt: null }], usageRange(id), NOW);

    it('each bucket becomes a point with the average of the value and of the instant; empty buckets disappear', () => {
      const bucket = (7 * DAY_MS) / CHART_BUCKETS;
      expect(weekly('7d').windows[0]!.points).toEqual([
        [NOW - 7 * DAY_MS, 10],
        [NOW - 6 * DAY_MS - 30 * MINUTE_MS - 1, 10],
        [NOW - 6 * DAY_MS - 30 * MINUTE_MS, 12],
        [NOW - 6 * DAY_MS, 15],
        [NOW - 5 * DAY_MS - 1, 15],
        [NOW - 5 * DAY_MS + 5 * MINUTE_MS, 16.5],
        [NOW - HOUR_MS - 1, 17],
        [NOW - 55 * MINUTE_MS, 30.5],
      ]);
      expect(bucket).toBeGreaterThan(80 * MINUTE_MS);
    });

    it('30d also includes the old stretch, still in at most 120 points', () => {
      expect(weekly('30d').windows[0]!.points[0]).toEqual([NOW - 20 * DAY_MS, 10]);
      const dense: UsagePoint[] = Array.from({ length: 5000 }, (_, index) => ({ at: NOW - index * 5 * MINUTE_MS, utilization: index % 100, resetsAt: null }));
      expect(downsample(dense, NOW - 30 * DAY_MS, NOW).length).toBeLessThanOrEqual(CHART_BUCKETS);
    });

    it('gaps and resets get no special treatment: only the average points', () => {
      const points = downsample(
        [
          { at: 0, utilization: 80, resetsAt: 10 },
          { at: 1000, utilization: 5, resetsAt: 2000 },
        ],
        0,
        1200,
      );
      expect(points).toEqual([
        [0, 80],
        [1000, 5],
      ]);
    });

    it('the series is smooth (0.5), with no auxiliary gap series and no connectNulls', () => {
      const out = buildChartOption(weekly('7d'), palette) as unknown as { series: { smooth: number; connectNulls?: boolean; silent?: boolean; areaStyle?: unknown }[] };
      expect(out.series[0]).toMatchObject({ smooth: 0.5 });
      expect(out.series[0]).not.toHaveProperty('connectNulls');
      expect(out.series).toHaveLength(1);
    });

    it('tooltip interpolates on the curve (Catmull-Rom) and does not mention estimated', () => {
      const model = weekly('7d');
      const format = tooltipFormatter(model, palette, PT);
      const points = model.windows[0]!.points;
      const start = points.findIndex((point) => point[1] === 17);
      const mid = (points[start]![0] + points[start + 1]![0]) / 2;
      const value = curveValueAt(points, mid)!;
      expect(value).toBeGreaterThan(17);
      expect(value).toBeLessThan(30.5);
      const text = format([{ axisValue: mid }]);
      expect(text).toContain(`7d ${Math.round(value)}%`);
      expect(text).not.toMatch(/estimado|sem leitura/);
    });

    it('curve passes through the points, stays at the last one after it and disappears before the first', () => {
      const points: [number, number][] = [
        [0, 10],
        [10, 20],
        [20, 40],
        [30, 30],
      ];
      expect(curveValueAt(points, 10)).toBe(20);
      expect(curveValueAt(points, 20)).toBe(40);
      expect(curveValueAt(points, 15)).toBeCloseTo(0.5 * (40 + (40 - 10) * 0.5 + (20 - 100 + 160 - 30) * 0.25 + (60 - 10 - 120 + 30) * 0.125), 9);
      expect(curveValueAt(points, 35)).toBe(30);
      expect(curveValueAt(points, -1)).toBeNull();
      expect(curveValueAt([], 5)).toBeNull();
    });

    it('also applies to 5h', () => {
      const model = buildChartModel(
        [{ kind: 'fiveHour', label: '5h', points: [{ at: NOW - 40 * MINUTE_MS, utilization: 90, resetsAt: null }, { at: NOW - 10 * MINUTE_MS, utilization: 4, resetsAt: null }], forecast: { status: 'collecting' }, resetsAt: null }],
        usageRange('1h'),
        NOW,
      );
      expect(model.windows[0]!.points).toEqual([
        [NOW - 40 * MINUTE_MS, 90],
        [NOW - 10 * MINUTE_MS - 1, 90],
        [NOW - 10 * MINUTE_MS, 4],
      ]);
    });
  });

  it('markers: now and the 5h resets that fall in the interval (past ones and the next)', () => {
    const model = buildChartModel(cycleInputs(), usageRange('cycle'), NOW);
    expect(model.fiveHourResets).toEqual([
      NOW - 3 * 24 * HOUR_MS + 5 * HOUR_MS,
      NOW - 2 * 24 * HOUR_MS + 5 * HOUR_MS,
      NOW + 4 * HOUR_MS,
    ]);
    const option = buildChartOption(model, palette) as unknown as {
      series: { markLine?: { data: { xAxis: number }[] } }[];
    };
    const marks = option.series[0]!.markLine!.data.map((mark) => mark.xAxis);
    expect(marks).toEqual([NOW, ...model.fiveHourResets]);
  });

  it('without a known weekly reset it falls back to the default period, without a cycle', () => {
    const noReset = cycleInputs().map((input) => (input.kind === 'sevenDay' ? { ...input, resetsAt: null } : input));
    const model = buildChartModel(noReset, usageRange('cycle'), NOW);
    expect(model.cycle).toBe(false);
    expect(model.xMin).toBe(NOW - 6 * HOUR_MS);
    expect(model.fiveHourResets).toEqual([]);
  });

  it('regular periods do not turn on cycle mode', () => {
    expect(buildChartModel(cycleInputs(), usageRange('7d'), NOW)).toMatchObject({ cycle: false, fiveHourResets: [] });
  });
});

describe('last known level across the range', () => {
  const SIX_HOURS_FROM = NOW - 6 * HOUR_MS;
  const window = (kind: 'fiveHour' | 'sevenDay', points: UsagePoint[], resetsAt: number | null = null): WindowInput => ({
    kind,
    label: kind === 'fiveHour' ? '5h' : '7d',
    points,
    forecast: { status: 'collecting' },
    resetsAt,
  });

  it('a range without inside readings draws the previous reading from the start of the range up to now', () => {
    const before: UsagePoint = { at: SIX_HOURS_FROM - 2 * HOUR_MS, utilization: 35, resetsAt: NOW + 2 * DAY_MS };
    for (const id of ['1h', '6h']) {
      const model = buildChartModel([window('sevenDay', [before])], usageRange(id), NOW);
      const points = model.windows[0]!.points;
      expect(points[0]).toEqual([model.xMin, 35]);
      expect(points.at(-1)).toEqual([NOW, 35]);
      expect(curveValueAt(points, (model.xMin + NOW) / 2)).toBe(35);
    }
  });

  it('a reset inside the range drops the series to the post-reset level', () => {
    const resetsAt = NOW - 2 * HOUR_MS;
    const model = buildChartModel([window('fiveHour', [{ at: SIX_HOURS_FROM - HOUR_MS, utilization: 64, resetsAt }])], usageRange('6h'), NOW);
    const points = model.windows[0]!.points;
    expect(curveValueAt(points, SIX_HOURS_FROM)).toBe(64);
    expect(curveValueAt(points, resetsAt - MINUTE_MS)).toBeCloseTo(64, 6);
    expect(curveValueAt(points, resetsAt + MINUTE_MS)).toBeCloseTo(0, 6);
    expect(points.at(-1)).toEqual([NOW, 0]);
  });

  it('in Reset a weekly reset with jitter just after the start of the cycle does not carry the previous week in', () => {
    const before: UsagePoint = { at: WEEKLY_RESET - CYCLE_MS - HOUR_MS, utilization: 92, resetsAt: WEEKLY_RESET - CYCLE_MS + 500 };
    const current: UsagePoint = { at: NOW, utilization: 30, resetsAt: WEEKLY_RESET };
    const model = buildChartModel([{ ...window('sevenDay', [before, current], WEEKLY_RESET), forecast: ready(60) }], usageRange('cycle'), NOW);
    expect(model.cycle).toBe(true);
    const points = model.windows[0]!.points;
    expect(points[0]).toEqual([model.xMin, 0]);
    expect(Math.max(...points.filter((point) => point[0] <= model.xMin + HOUR_MS).map((point) => point[1]))).toBe(0);
  });

  it('without any reading the series stays empty', () => {
    const model = buildChartModel([window('fiveHour', []), window('sevenDay', [])], usageRange('6h'), NOW);
    expect(model.windows.map((series) => series.points)).toEqual([[], []]);
  });

  it('the screenshot case: idle since last night, two readings near now, 7d at 35% with a projection', () => {
    const at = (hours: number) => NOW - hours * HOUR_MS;
    const stored = {
      schemaVersion: 1,
      fiveHour: [
        [at(14), 30, at(11)],
        [at(13), 32, at(11)],
        [at(0.25), 5, at(-4.75)],
        [NOW, 5, at(-4.75)],
      ],
      sevenDay: [
        [at(14), 34, at(-50)],
        [at(13), 35, at(-50)],
        [at(0.25), 35, at(-50)],
        [NOW, 35, at(-50)],
      ],
    };
    const history = parseHistory(stored);
    const weekly = forecastWindow('sevenDay', 'since-reset', history.sevenDay, NOW, 35, at(-50));
    const model = buildChartModel(
      [
        { ...window('fiveHour', history.fiveHour, at(-4.75)), forecast: forecastWindow('fiveHour', 'since-reset', history.fiveHour, NOW, 5, at(-4.75)) },
        { ...window('sevenDay', history.sevenDay, at(-50)), forecast: weekly },
      ],
      usageRange('6h'),
      NOW,
    );
    const [fiveHour, sevenDay] = model.windows;
    for (const probe of [model.xMin, at(5), at(3), at(1), NOW]) expect(curveValueAt(sevenDay!.points, probe)).toBeCloseTo(35, 6);
    for (const probe of [model.xMin, at(3), at(0.5)]) expect(curveValueAt(fiveHour!.points, probe)).toBeCloseTo(0, 6);
    expect(curveValueAt(fiveHour!.points, NOW)).toBe(5);
    expect(sevenDay!.trend?.[0]).toEqual([NOW, 35]);
    expect(weekly.status).toBe('ready');
  });
});

describe('smooth chart line', () => {
  const reading = (at: number, utilization: number, resetsAt: number | null = null): UsagePoint => ({ at, utilization, resetsAt });
  const modelOf = (list: UsagePoint[], line?: 'stepped' | 'smooth', range = '1d') =>
    buildChartModel([{ kind: 'fiveHour', label: '5h', points: list, forecast: { status: 'collecting' }, resetsAt: null }], usageRange(range), NOW, line);
  const build = (list: UsagePoint[], line: 'stepped' | 'smooth') => modelOf(list, line).windows[0]!;
  const consecutive = [reading(NOW - 10 * HOUR_MS, 20), reading(NOW - 8 * HOUR_MS, 30), reading(NOW - 6 * HOUR_MS, 35), reading(NOW - 4 * HOUR_MS, 38), reading(NOW - 2 * HOUR_MS, 40), reading(NOW - 5 * MINUTE_MS, 41)];

  it('stepped is the default and does not change the output', () => {
    const explicit = build(consecutive, 'stepped');
    expect(modelOf(consecutive).windows[0]!.points).toEqual(explicit.points);
    expect(explicit.points).toContainEqual([NOW - 8 * HOUR_MS - 1, 20]);
  });

  it('consecutive readings are joined directly, with no flat stretch before each jump', () => {
    expect(build(consecutive, 'smooth').points).toEqual([
      [NOW - 10 * HOUR_MS, 20],
      [NOW - 8 * HOUR_MS, 30],
      [NOW - 6 * HOUR_MS, 35],
      [NOW - 4 * HOUR_MS, 38],
      [NOW - 2 * HOUR_MS, 40],
      [NOW - 5 * MINUTE_MS, 41],
    ]);
  });

  it('a reset drop stays vertical between the readings around it', () => {
    const resetsAt = NOW - 3 * HOUR_MS;
    const smooth = build([reading(NOW - 4 * HOUR_MS, 80, resetsAt), reading(NOW - 2 * HOUR_MS, 3), reading(NOW - 5 * MINUTE_MS, 6)], 'smooth');
    expect(smooth.points).toEqual([
      [NOW - 4 * HOUR_MS, 80],
      [resetsAt, 80],
      [resetsAt, 0],
      [NOW - 2 * HOUR_MS, 3],
      [NOW - 5 * MINUTE_MS, 6],
    ]);
    expect(curveValueAt(smooth.points, resetsAt - 1)).toBeGreaterThan(70);
    expect(curveValueAt(smooth.points, resetsAt + MINUTE_MS)).toBeLessThan(5);
  });

  it('a long gap holds the level and then steps, instead of sloping across the gap', () => {
    const smooth = build([reading(NOW - 20 * HOUR_MS, 10), reading(NOW - 10 * HOUR_MS, 25), reading(NOW - 5 * MINUTE_MS, 26)], 'smooth');
    expect(smooth.points).toEqual([
      [NOW - 20 * HOUR_MS, 10],
      [NOW - 10 * HOUR_MS - 1, 10],
      [NOW - 10 * HOUR_MS, 25],
      [NOW - 5 * MINUTE_MS - 1, 25],
      [NOW - 5 * MINUTE_MS, 26],
    ]);
    expect(curveValueAt(smooth.points, NOW - 15 * HOUR_MS)).toBe(10);
  });

  it('range edge: carries the reading before the range in and never draws past now', () => {
    const smooth = build([reading(NOW - 30 * HOUR_MS, 12), reading(NOW - 2 * HOUR_MS, 18)], 'smooth');
    expect(smooth.points[0]).toEqual([NOW - DAY_MS, 12]);
    expect(Math.max(...smooth.points.map((point) => point[0]))).toBeLessThanOrEqual(NOW);
    expect(smooth.points.at(-1)).toEqual([NOW, 18]);
    expect(curveValueAt(smooth.points, NOW)).toBe(18);
  });

  it('a range with no reading stays empty', () => {
    expect(build([], 'smooth').points).toEqual([]);
  });

  it('the tooltip reads the line through the same curve function in both modes', () => {
    for (const line of ['stepped', 'smooth'] as const) {
      const model = modelOf(consecutive, line);
      const format = tooltipFormatter(model, palette, PT);
      for (const at of [NOW - 9 * HOUR_MS, NOW - 7 * HOUR_MS, NOW - 3 * HOUR_MS]) {
        const value = curveValueAt(model.windows[0]!.points, at)!;
        expect(format([{ axisValue: at }])).toContain(`5h ${Math.round(value)}%`);
      }
    }
    const mid = NOW - 9 * HOUR_MS;
    expect(curveValueAt(build(consecutive, 'smooth').points, mid)).toBeGreaterThan(20);
    expect(curveValueAt(build(consecutive, 'stepped').points, mid)).toBe(20);
  });

  it('the series option keeps the same curve smoothing in both modes', () => {
    for (const line of ['stepped', 'smooth'] as const) {
      const out = buildChartOption(modelOf(consecutive, line), palette) as unknown as { series: { smooth: number }[] };
      expect(out.series[0]).toMatchObject({ smooth: 0.5 });
    }
  });

  describe('with the real 5-minute polling and 5h cycles', () => {
    const CYCLE = 5 * HOUR_MS;
    const dense = (): UsagePoint[] => {
      const list: UsagePoint[] = [];
      for (let at = NOW - 31 * DAY_MS + 90_000; at <= NOW; at += 5 * MINUTE_MS) {
        const start = Math.floor(at / CYCLE) * CYCLE;
        list.push(reading(at, (90 * (at - start)) / CYCLE, start + CYCLE));
      }
      return list;
    };

    for (const range of ['1d', '7d', '30d']) {
      it(`${range}: no vertical pair and no drop-and-bounce between the readings of a reset`, () => {
        const smooth = modelOf(dense(), 'smooth', range).windows[0]!.points;
        const xs = smooth.map((point) => point[0]);
        expect(new Set(xs).size).toBe(xs.length);
        const stepped = modelOf(dense(), 'stepped', range).windows[0]!.points;
        expect(smooth.filter((point) => point[1] === 0).length).toBeLessThanOrEqual(stepped.filter((point) => point[1] === 0).length);
        for (let index = 1; index < smooth.length - 1; index++) {
          const [before, here, after] = [smooth[index - 1]![1], smooth[index]![1], smooth[index + 1]![1]];
          const bounce = here < before - 30 && after > here + 30 && smooth[index + 1]![0] - smooth[index]![0] < 30 * MINUTE_MS;
          expect(bounce).toBe(false);
        }
      });
    }
  });

  it('a reset right at the next reading is a vertical drop, not a slope across the gap', () => {
    const resetsAt = NOW - 4 * HOUR_MS;
    const smooth = build([reading(NOW - 5 * HOUR_MS, 70, resetsAt), reading(resetsAt, 0, NOW + HOUR_MS), reading(NOW - 3 * HOUR_MS, 5, NOW + HOUR_MS), reading(NOW - 5 * MINUTE_MS, 6, NOW + HOUR_MS)], 'smooth');
    expect(smooth.points).toContainEqual([resetsAt - 1, 70]);
    expect(smooth.points).toContainEqual([resetsAt - 1, 0]);
    expect(curveValueAt(smooth.points, resetsAt - 30 * MINUTE_MS)).toBeGreaterThan(60);
  });
});
