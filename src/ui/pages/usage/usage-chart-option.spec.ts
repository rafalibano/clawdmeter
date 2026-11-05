import { describe, expect, it } from 'vitest';
import { HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { usageRange, type Forecast } from '../../../domain/usage';
import { chartPalette } from '../../theme/chart-palette';
import { buildChartModel, FUTURE_SHARE } from './usage-chart-model';
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

describe('buildChartModel', () => {
  it('eixo vai de agora - período até agora + folga para a tendência', () => {
    const range = usageRange('1h');
    const model = buildChartModel(points, { status: 'collecting' }, range, NOW);
    expect(model.xMin).toBe(NOW - HOUR_MS);
    expect(model.xMax).toBe(NOW + HOUR_MS * FUTURE_SHARE);
    expect(model.series).toHaveLength(10);
    expect(model.trend).toBeNull();
  });

  it('tendência é cortada na borda do eixo e interpolada', () => {
    const model = buildChartModel(points, ready(69), usageRange('1h'), NOW);
    const end = model.trend?.[1];
    expect(model.trend?.[0]).toEqual([NOW, 29]);
    expect(end?.[0]).toBe(model.xMax);
    expect(end?.[1]).toBeCloseTo(29 + (40 * HOUR_MS * FUTURE_SHARE) / (4 * HOUR_MS), 5);
  });

  it('tendência que estoura termina em 100% no horário do estouro', () => {
    const exhaustsAt = NOW + 10 * MINUTE_MS;
    const model = buildChartModel(points, ready(300, exhaustsAt), usageRange('12h'), NOW);
    expect(model.trend?.[1]).toEqual([exhaustsAt, 100]);
  });

  it('reset antes da borda: a tendência termina no reset', () => {
    const forecast = ready(40);
    const near = { ...forecast, trend: { ...(forecast as { trend: object }).trend, toAt: NOW + 5 * MINUTE_MS, toValue: 31 } } as Forecast;
    expect(buildChartModel(points, near, usageRange('30d'), NOW).trend?.[1]).toEqual([NOW + 5 * MINUTE_MS, 31]);
  });
});

describe('buildChartOption', () => {
  const model = buildChartModel(points, ready(60), usageRange('1h'), NOW);
  const option = buildChartOption(model, palette) as {
    xAxis: { min: number; max: number; axisLabel: { formatter: (value: number) => string } };
    yAxis: { min: number; max: number };
    series: { name: string; data: unknown; lineStyle: { type?: string }; markLine?: { data: Record<string, unknown>[] } }[];
  };

  it('eixo y de 0 a 100 com marca em 100% e em "agora"', () => {
    expect(option.yAxis).toMatchObject({ min: 0, max: 100 });
    const marks = option.series[0]!.markLine!.data;
    expect(marks.some((mark) => mark['yAxis'] === 100)).toBe(true);
    expect(marks.some((mark) => mark['xAxis'] === NOW)).toBe(true);
  });

  it('série real + linha de tendência tracejada ligada ao último ponto', () => {
    expect(option.series.map((series) => series.name)).toEqual(['Uso', 'Tendência']);
    expect(option.series[1]!.lineStyle.type).toBe('dashed');
    expect((option.series[1]!.data as number[][])[0]).toEqual([NOW, 29]);
  });

  it('série, área e tendência em verde Mottu; 100% em alert; fonte Helvetica', () => {
    const full = option as unknown as {
      textStyle: { fontFamily: string };
      series: { lineStyle: { color: string }; areaStyle?: { color: string; opacity: number }; markLine?: { data: { yAxis?: number; lineStyle: { color: string } }[] } }[];
    };
    expect(full.series[0]!.lineStyle.color).toBe('#00b131');
    expect(full.series[0]!.areaStyle).toEqual({ color: '#00b131', opacity: 0.12 });
    expect(full.series[1]!.lineStyle.color).toBe('#1bd60b');
    expect(full.series[0]!.markLine!.data.find((mark) => mark.yAxis === 100)!.lineStyle.color).toBe('#ff5449');
    expect(full.textStyle.fontFamily).toBe('"Helvetica Neue", Helvetica, Arial, sans-serif');
  });

  it('sem previsão só desenha a série real', () => {
    const plain = buildChartOption(buildChartModel(points, { status: 'collecting' }, usageRange('1h'), NOW), palette) as {
      series: unknown[];
    };
    expect(plain.series).toHaveLength(1);
  });

  it('rótulos do eixo usam hora local no período curto e dia/mês no longo', () => {
    expect(option.xAxis.axisLabel.formatter(NOW)).toMatch(/^\d{2}:\d{2}$/);
    const long = buildChartOption(buildChartModel(points, { status: 'collecting' }, usageRange('30d'), NOW), palette) as typeof option;
    expect(long.xAxis.axisLabel.formatter(NOW)).toMatch(/^\d{2}\/\d{2}$/);
  });
});
