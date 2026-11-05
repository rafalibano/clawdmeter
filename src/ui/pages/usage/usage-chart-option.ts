import type { EChartsCoreOption } from 'echarts/core';
import { formatAxisTick } from '../../format/time';
import type { ChartPalette } from '../../theme/chart-palette';
import type { UsageChartModel } from './usage-chart-model';

const AXIS_MAX = 100;

export function buildChartOption(model: UsageChartModel, palette: ChartPalette): EChartsCoreOption {
  return {
    animation: false,
    textStyle: { fontFamily: palette.fontFamily },
    grid: { left: 34, right: 10, top: 8, bottom: 22 },
    xAxis: {
      type: 'time',
      min: model.xMin,
      max: model.xMax,
      axisLine: { lineStyle: { color: palette.grid } },
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
      min: 0,
      max: AXIS_MAX,
      interval: 50,
      axisLabel: { color: palette.muted, fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: palette.grid } },
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      valueFormatter: (value: unknown) => `${Math.round(Number(value))}%`,
      axisPointer: { lineStyle: { color: palette.muted } },
    },
    series: [
      {
        name: 'Uso',
        type: 'line',
        showSymbol: false,
        sampling: 'max',
        data: model.series,
        lineStyle: { width: 2, color: palette.line },
        itemStyle: { color: palette.line },
        areaStyle: { color: palette.area, opacity: 0.12 },
        markLine: {
          silent: true,
          symbol: 'none',
          animation: false,
          data: [
            { yAxis: AXIS_MAX, lineStyle: { color: palette.danger, type: 'solid', width: 1 }, label: { show: false } },
            {
              xAxis: model.now,
              lineStyle: { color: palette.muted, type: 'dotted', width: 1 },
              label: { show: true, formatter: 'agora', color: palette.muted, fontSize: 10, position: 'insideEndTop' },
            },
          ],
        },
      },
      ...(model.trend === null
        ? []
        : [
            {
              name: 'Tendência',
              type: 'line',
              showSymbol: false,
              silent: true,
              data: model.trend,
              lineStyle: { width: 2, type: 'dashed', color: palette.trend },
              itemStyle: { color: palette.trend },
              tooltip: { show: false },
              z: 3,
            },
          ]),
    ],
  };
}
