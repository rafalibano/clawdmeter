import { describe, expect, it } from 'vitest';
import { HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { usageRange, type Forecast } from '../../../domain/usage';
import { chartPalette } from '../../theme/chart-palette';
import { buildChartModel, FUTURE_SHARE, type WindowInput } from './usage-chart-model';
import { buildChartOption } from './usage-chart-option';

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
  valueAtReset: toValue,
  trend: { fromAt: NOW, fromValue: 29, toAt: NOW + 4 * HOUR_MS, toValue },
  exhaustsAt,
  exhaustsLeadMs: exhaustsAt === null ? null : NOW + 4 * HOUR_MS - exhaustsAt,
});

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
  it('eixo vai de agora - período até agora + folga para a tendência', () => {
    const model = buildChartModel(inputs({ status: 'collecting' }), usageRange('1h'), NOW);
    expect(model.xMin).toBe(NOW - HOUR_MS);
    expect(model.xMax).toBe(NOW + HOUR_MS * FUTURE_SHARE);
    expect(model.windows.map((window) => window.points.length)).toEqual([10, 10]);
    expect(model.windows[0]!.trend).toBeNull();
  });

  it('tendência é cortada na borda do eixo e interpolada', () => {
    const model = buildChartModel(inputs(ready(69)), usageRange('1h'), NOW);
    const trend = model.windows[0]!.trend;
    expect(trend?.[0]).toEqual([NOW, 29]);
    expect(trend?.[1]?.[0]).toBe(model.xMax);
    expect(trend?.[1]?.[1]).toBeCloseTo(29 + (40 * HOUR_MS * FUTURE_SHARE) / (4 * HOUR_MS), 5);
  });

  it('tendência que estoura termina em 100% no horário do estouro', () => {
    const exhaustsAt = NOW + 10 * MINUTE_MS;
    const model = buildChartModel(inputs(ready(300, exhaustsAt)), usageRange('6h'), NOW);
    expect(model.windows[0]!.trend?.[1]).toEqual([exhaustsAt, 100]);
  });

  it('reset antes da borda: a tendência termina no reset', () => {
    const forecast = ready(40);
    const near = { ...forecast, trend: { ...(forecast as { trend: object }).trend, toAt: NOW + 5 * MINUTE_MS, toValue: 31 } } as Forecast;
    expect(buildChartModel(inputs(near), usageRange('30d'), NOW).windows[0]!.trend?.[1]).toEqual([NOW + 5 * MINUTE_MS, 31]);
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
    textStyle: { fontFamily: string };
    series: {
      name: string;
      smooth?: boolean;
      data: number[][];
      lineStyle: { color: string; type?: string; width: number };
      areaStyle?: { color: { type: string; colorStops: { offset: number; color: string }[] } };
      markLine?: { data: { xAxis?: number; yAxis?: number; lineStyle: { color: string; type: string } }[] };
    }[];
  };

  it('eixo y à direita de 0 a 100 de 25 em 25, sem linha forte, grade tracejada leve', () => {
    expect(option.yAxis).toMatchObject({ min: 0, max: 100, interval: 25, position: 'right' });
    expect(option.xAxis.axisLine.show).toBe(false);
    expect(option.yAxis.axisLine.show).toBe(false);
    expect(option.yAxis.splitLine.lineStyle).toMatchObject({ color: 'rgba(18, 18, 18, 0.06)', type: 'dashed' });
  });

  it('duas séries suaves (5h e 7d) e uma tendência tracejada e mais fina por série com previsão', () => {
    expect(option.series.map((series) => series.name)).toEqual(['5h', '7d', '5h tendência', '7d tendência']);
    expect(option.series[0]!.smooth).toBe(true);
    expect(option.series[2]!.lineStyle).toMatchObject({ type: 'dashed', width: 1.2 });
    expect(option.series[2]!.lineStyle.width).toBeLessThan(option.series[0]!.lineStyle.width);
    expect(option.series[2]!.data[0]).toEqual([NOW, 29]);
  });

  it('5h em verde Mottu e 7d em azul do DS, com área muito leve', () => {
    expect(option.series[0]!.lineStyle.color).toBe('#00b131');
    expect(option.series[1]!.lineStyle.color).toBe('#0063f7');
    expect(option.series[2]!.lineStyle.color).toBe('#00b131');
    expect(option.series[0]!.areaStyle?.color.colorStops).toEqual([
      { offset: 0, color: 'rgba(0, 177, 49, 0.1)' },
      { offset: 1, color: 'rgba(0, 177, 49, 0)' },
    ]);
    const dark = buildChartOption(model, chartPalette('#00b131', null, 'dark')) as unknown as typeof option;
    expect(dark.series[0]!.lineStyle.color).toBe('#1bd60b');
    expect(dark.series[1]!.lineStyle.color).toBe('#5c9dff');
  });

  it('marcas: 100% em alert tracejado e translúcido, "agora" e os resets dentro do eixo', () => {
    const marks = option.series[0]!.markLine!.data;
    expect(marks.find((mark) => mark.yAxis === 100)!.lineStyle).toEqual({ color: 'rgba(255, 84, 73, 0.5)', type: 'dashed', width: 1 });
    expect(marks.some((mark) => mark.xAxis === NOW)).toBe(true);
    expect(marks.filter((mark) => mark.xAxis !== undefined && mark.xAxis > NOW)).toHaveLength(0);
    const wide = buildChartOption(buildChartModel(inputs(ready(60)), usageRange('30d'), NOW), palette) as unknown as typeof option;
    const resets = wide.series[0]!.markLine!.data.filter((mark) => mark.xAxis !== undefined && mark.xAxis > NOW);
    expect(resets.map((mark) => mark.xAxis)).toEqual([NOW + 4 * HOUR_MS, NOW + 3 * 24 * HOUR_MS]);
  });

  it('em períodos longos a linha real afina, e a tendência continua mais fina que ela', () => {
    const long = buildChartOption(buildChartModel(inputs(ready(60)), usageRange('30d'), NOW), palette) as unknown as typeof option;
    expect(long.series[0]!.lineStyle.width).toBe(1.5);
    expect(long.series[2]!.lineStyle.width).toBeLessThan(1.5);
  });

  it('tooltip na cor do card e fonte Helvetica', () => {
    expect(option.tooltip.backgroundColor).toBe('#ffffff');
    expect(option.textStyle.fontFamily).toBe('"Helvetica Neue", Helvetica, Arial, sans-serif');
  });

  it('sem previsão só desenha as duas séries reais', () => {
    const plain = buildChartOption(buildChartModel(inputs({ status: 'collecting' }), usageRange('1h'), NOW), palette) as unknown as {
      series: unknown[];
    };
    expect(plain.series).toHaveLength(2);
  });

  it('rótulos do eixo usam hora local no período curto e dia/mês no longo', () => {
    expect(option.xAxis.axisLabel.formatter(NOW)).toMatch(/^\d{2}:\d{2}$/);
    const long = buildChartOption(buildChartModel(inputs({ status: 'collecting' }), usageRange('30d'), NOW), palette) as unknown as typeof option;
    expect(long.xAxis.axisLabel.formatter(NOW)).toMatch(/^\d{2}\/\d{2}$/);
  });
});
