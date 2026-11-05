import type { EChartsCoreOption } from 'echarts/core';
import { DAY_MS } from '../../../domain/time';
import type { Localizer } from '../../i18n';
import { withAlpha, type ChartPalette, type SeriesColors } from '../../theme/chart-palette';
import type { UsageChartModel, WindowSeries } from './usage-chart-model';
import type { UsageTone } from './usage-tone';

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
  const resets = model.cycle
    ? model.fiveHourResets.map((at) => ({ xAxis: at, lineStyle: { color: withAlpha(palette.series.fiveHour.line, 0.14), type: 'dashed', width: 1 }, label: { show: false } }))
    : model.windows
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

function strokeColor(colors: SeriesColors, width: number, type?: string, color: string = colors.line) {
  const lineStyle = type === undefined ? { width, color } : { width, type, color };
  return { lineStyle, itemStyle: { color } };
}

function toneColor(tone: UsageTone, colors: SeriesColors, palette: ChartPalette): string {
  if (tone === 'danger') return palette.danger;
  return tone === 'attention' ? palette.attention : colors.line;
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
    ...strokeColor(colors, width),
    areaStyle: fade(colors),
    ...(withMarkers === null ? {} : { markLine: { silent: true, symbol: 'none', animation: false, data: withMarkers } }),
  };
}

function trendSeries(window: WindowSeries, palette: ChartPalette, l: Localizer) {
  const colors = palette.series[window.kind];
  return {
    name: l.t('usage.trend', { label: window.label }),
    type: 'line',
    showSymbol: false,
    silent: true,
    data: window.trend,
    ...strokeColor(colors, 1.2, 'dashed', toneColor(window.trendTone, colors, palette)),
    tooltip: { show: false },
    z: 3,
  };
}

export function buildChartOption(model: UsageChartModel, palette: ChartPalette, l: Localizer): EChartsCoreOption {
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
        formatter: (value: number) => l.axisTick(value, model.rangeMs),
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
    series: [
      ...model.windows.map((window, index) => realSeries(window, palette, lineWidth, index === 0 ? markers(model, palette) : null)),
      ...model.windows.flatMap((window) => (window.trend === null ? [] : [trendSeries(window, palette, l)])),
    ],
  };
}
