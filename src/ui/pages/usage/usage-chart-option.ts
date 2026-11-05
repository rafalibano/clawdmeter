import type { EChartsCoreOption } from 'echarts/core';
import { DAY_MS } from '../../../domain/time';
import { formatAxisTick } from '../../format/time';
import type { ChartPalette, SeriesColors } from '../../theme/chart-palette';
import type { UsageChartModel, WindowSeries } from './usage-chart-model';
import { WEEKLY_ATTENTION_AT, WEEKLY_DANGER_AT } from './usage-tone';

const AXIS_MAX = 100;

function fade(colors: SeriesColors) {
  return {
    color: {
      type: 'linear',
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: colors.area },
        { offset: 1, color: colors.areaFade },
      ],
    },
  };
}

function markers(model: UsageChartModel, palette: ChartPalette) {
  const resets = model.windows
    .filter((window) => window.resetsAt !== null && window.resetsAt > model.now && window.resetsAt <= model.xMax)
    .map((window) => ({
      xAxis: window.resetsAt,
      lineStyle: { color: palette.series[window.kind].marker, type: 'dashed', width: 1 },
      label: { show: false },
    }));
  return [
    { xAxis: model.now, lineStyle: { color: palette.now, type: 'dashed', width: 1 }, label: { show: false } },
    ...resets,
  ];
}

function strokeColor(window: WindowSeries, colors: SeriesColors, width: number, type?: string) {
  const lineStyle = type === undefined ? { width } : { width, type };
  if (window.kind === 'sevenDay') return { lineStyle };
  return { lineStyle: { ...lineStyle, color: colors.line }, itemStyle: { color: colors.line } };
}

function realSeries(window: WindowSeries, palette: ChartPalette, width: number, withMarkers: unknown) {
  const colors = palette.series[window.kind];
  return {
    name: window.label,
    type: 'line',
    smooth: true,
    showSymbol: false,
    sampling: 'lttb',
    data: window.points,
    ...strokeColor(window, colors, width),
    areaStyle: fade(colors),
    ...(withMarkers === null ? {} : { markLine: { silent: true, symbol: 'none', animation: false, data: withMarkers } }),
  };
}

function trendSeries(window: WindowSeries, palette: ChartPalette) {
  const colors = palette.series[window.kind];
  return {
    name: `${window.label} tendência`,
    type: 'line',
    showSymbol: false,
    silent: true,
    data: window.trend,
    ...strokeColor(window, colors, 1.2, 'dashed'),
    tooltip: { show: false },
    z: 3,
  };
}

function weeklyVisualMap(model: UsageChartModel, palette: ChartPalette) {
  const trended = model.windows.filter((window) => window.trend !== null);
  const seriesIndex = model.windows.flatMap((window, index) => (window.kind === 'sevenDay' ? [index] : []));
  trended.forEach((window, index) => {
    if (window.kind === 'sevenDay') seriesIndex.push(model.windows.length + index);
  });
  const neutral = palette.series.sevenDay.line;
  return {
    type: 'piecewise',
    show: false,
    dimension: 1,
    seriesIndex,
    pieces: [
      { lt: WEEKLY_ATTENTION_AT, color: neutral },
      { gte: WEEKLY_ATTENTION_AT, lt: WEEKLY_DANGER_AT, color: palette.attention },
      { gte: WEEKLY_DANGER_AT, color: palette.danger },
    ],
    outOfRange: { color: neutral },
  };
}

export function buildChartOption(model: UsageChartModel, palette: ChartPalette): EChartsCoreOption {
  const lineWidth = model.rangeMs > DAY_MS ? 1.5 : 2;
  return {
    animation: false,
    textStyle: { fontFamily: palette.fontFamily },
    grid: { left: 6, right: 34, top: 10, bottom: 22 },
    xAxis: {
      type: 'time',
      min: model.xMin,
      max: model.xMax,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: palette.muted,
        fontSize: 10,
        hideOverlap: true,
        formatter: (value: number) => formatAxisTick(value, model.rangeMs),
      },
    },
    yAxis: {
      type: 'value',
      position: 'right',
      min: 0,
      max: AXIS_MAX,
      interval: 25,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: palette.muted, fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: palette.grid, type: 'dashed', width: 1 } },
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: palette.tooltipBackground,
      borderColor: palette.tooltipBorder,
      borderWidth: 1,
      padding: [6, 10],
      extraCssText: 'border-radius: 8px; box-shadow: none;',
      textStyle: { color: palette.text, fontSize: 11, fontFamily: palette.fontFamily },
      valueFormatter: (value: unknown) => `${Math.round(Number(value))}%`,
      axisPointer: { lineStyle: { color: palette.now, type: 'dashed' } },
    },
    visualMap: weeklyVisualMap(model, palette),
    series: [
      ...model.windows.map((window, index) => realSeries(window, palette, lineWidth, index === 0 ? markers(model, palette) : null)),
      ...model.windows.flatMap((window) => (window.trend === null ? [] : [trendSeries(window, palette)])),
    ],
  };
}
