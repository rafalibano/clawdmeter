import type { ConnectionAction } from '../../../domain/connections';
import { EXHAUSTION_LEVEL, USAGE_WINDOWS, usageRange, type Forecast, type UsageWindowKind } from '../../../domain/usage';
import type { UsageData } from '../../../application/use-cases';
import { formatSpan } from '../../format/time';
import type { ConnectionRowView } from '../../settings/connections/connection-view';
import { buildChartModel, type UsageChartModel } from './usage-chart-model';

export interface UsageProjectionView {
  from: number;
  to: number;
  exhausts: boolean;
}

export interface UsageBarView {
  kind: UsageWindowKind;
  label: string;
  percent: string;
  fill: number;
  reset: string;
  projection: UsageProjectionView | null;
}

export interface UsageView {
  bars: UsageBarView[];
  chart: UsageChartModel;
}

export interface UsageErrorView {
  message: string;
  actions: ConnectionAction[];
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export function projectionOf(forecast: Forecast, current: number): UsageProjectionView | null {
  if (forecast.status !== 'ready') return null;
  const exhausts = forecast.valueAtReset >= EXHAUSTION_LEVEL;
  const from = clampPercent(current);
  return { from, to: exhausts ? EXHAUSTION_LEVEL : Math.max(from, clampPercent(forecast.valueAtReset)), exhausts };
}

export function resetText(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return 'sem janela ativa';
  const remaining = resetsAt - now;
  return remaining <= 0 ? 'reseta agora' : `reseta em ${formatSpan(remaining)}`;
}

export function toUsageView(data: UsageData, rangeId: string): UsageView {
  const bars = USAGE_WINDOWS.map(({ kind, label }): UsageBarView => {
    const reading = data.snapshot[kind];
    if (reading === null) return { kind, label, percent: '—', fill: 0, reset: '', projection: null };
    return {
      kind,
      label,
      percent: `${Math.round(reading.utilization)}%`,
      fill: clampPercent(reading.utilization),
      reset: resetText(reading.resetsAt, data.at),
      projection: projectionOf(data.forecasts[kind], reading.utilization),
    };
  });
  const chart = buildChartModel(
    USAGE_WINDOWS.map(({ kind, label }) => ({
      kind,
      label,
      points: data.history[kind],
      forecast: data.forecasts[kind],
      resetsAt: data.snapshot[kind]?.resetsAt ?? null,
    })),
    usageRange(rangeId),
    data.at,
  );
  return { bars, chart };
}

export function toUsageErrorView(updateError: string, claude: ConnectionRowView | undefined): UsageErrorView {
  if (claude === undefined || claude.tone === 'ok' || claude.tone === 'busy') {
    return { message: updateError, actions: [] };
  }
  return {
    message: claude.tone === 'error' ? (claude.message ?? updateError) : updateError,
    actions: claude.actions.filter((action) => action.kind !== 'disconnect'),
  };
}
