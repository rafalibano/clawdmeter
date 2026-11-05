import type { EChartsCoreOption } from 'echarts/core';
import { DAY_MS } from '../../../domain/time';
import { EXHAUSTION_LEVEL } from '../../../domain/usage';
import type { Localizer } from '../../i18n';
import { withAlpha, type ChartPalette, type SeriesColors } from '../../theme/chart-palette';
import { BASE_AXIS_MAX, CYCLE_MS, type UsageChartModel, type WindowSeries } from './usage-chart-model';
import type { UsageTone } from './usage-tone';

const COMPACT_AXIS_MAX = 200;
const REFERENCE_ALPHA = 0.4;

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
  const reference =
    model.yMax > BASE_AXIS_MAX
      ? [{ yAxis: EXHAUSTION_LEVEL, lineStyle: { color: withAlpha(palette.danger, REFERENCE_ALPHA), type: 'solid', width: 1 }, label: { show: false } }]
      : [];
  return [
    { xAxis: model.now, lineStyle: { color: palette.now, type: 'dashed', width: 1 }, label: { show: false } },
    ...resets,
    ...reference,
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

function projectionDate(at: number, l: Localizer): string {
  return `${l.axisTick(at, CYCLE_MS)} ${l.clock(at)}`;
}

function daysSeries(window: WindowSeries, palette: ChartPalette, l: Localizer) {
  const colors = palette.series[window.kind];
  return {
    name: l.t('usage.trend', { label: window.label }),
    type: 'scatter',
    symbolSize: 6,
    z: 4,
    data: window.days.map((day, index) => {
      const color = toneColor(day.tone, colors, palette);
      const edge = index === window.days.length - 1 ? { align: 'right', offset: [6, 0] } : {};
      return {
        value: [day.at, day.value],
        itemStyle: { color },
        label: { show: day.labeled, formatter: `${Math.round(day.value)}%`, color, ...edge },
      };
    }),
    label: { position: 'top', distance: 3, fontSize: 9, fontFamily: palette.fontFamily },
    tooltip: {
      trigger: 'item',
      formatter: (params: { value: [number, number] }) =>
        `${projectionDate(params.value[0], l)}<br/>${l.t('usage.projected', { value: Math.round(params.value[1]) })}`,
    },
  };
}

function yAxisLabel(model: UsageChartModel, palette: ChartPalette) {
  const expanded = model.yMax > BASE_AXIS_MAX;
  return {
    color: palette.muted,
    fontSize: 10,
    formatter: (value: number) => (expanded && value === EXHAUSTION_LEVEL ? `{reference|${value}%}` : `${value}%`),
    rich: { reference: { color: withAlpha(palette.danger, 0.85), fontSize: 10, fontWeight: 600 } },
  };
}

export function buildChartOption(model: UsageChartModel, palette: ChartPalette, l: Localizer): EChartsCoreOption {
  const lineWidth = model.rangeMs > DAY_MS ? 1.5 : 2;
  return {
    animation: false,
    textStyle: { fontFamily: palette.fontFamily },
    grid: { left: 6, right: 34, top: model.cycle ? 18 : 10, bottom: 22 },
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
      max: model.yMax,
      interval: model.yMax > COMPACT_AXIS_MAX ? 50 : 25,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: yAxisLabel(model, palette),
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
      ...model.windows.flatMap((window) => (window.days.length === 0 ? [] : [daysSeries(window, palette, l)])),
    ],
  };
}
