import type { ConnectionAction } from '../../../domain/connections';
import type { UsageThresholds } from '../../../domain/settings';
import {
  EXHAUSTION_LEVEL,
  USAGE_WINDOWS,
  isCycleAvailable,
  usageRange,
  type Forecast,
  type UsageWindowKind,
} from '../../../domain/usage';
import type { UsageData } from '../../../application/use-cases';
import type { Localizer } from '../../i18n';
import type { ConnectionRowView } from '../../settings/connections/connection-view';
import { buildChartModel, type UsageChartModel } from './usage-chart-model';
import { projectionTone, type UsageTone } from './usage-tone';

export interface UsageProjectionView {
  at: number;
  exhausts: boolean;
  tone: UsageTone;
  label: string;
}

export interface UsageBarView {
  kind: UsageWindowKind;
  label: string;
  percent: string;
  fill: number;
  tone: UsageTone;
  reset: string;
  projection: UsageProjectionView | null;
}

export interface UsageView {
  bars: UsageBarView[];
  chart: UsageChartModel;
  cycleAvailable: boolean;
}

export interface UsageErrorView {
  message: string;
  actions: ConnectionAction[];
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export function projectionOf(
  kind: UsageWindowKind,
  forecast: Forecast,
  current: number,
  thresholds: UsageThresholds,
  l: Localizer,
): UsageProjectionView | null {
  if (forecast.status !== 'ready') return null;
  const projected = Math.max(forecast.valueAtReset, current);
  return {
    at: Math.max(clampPercent(current), clampPercent(forecast.valueAtReset)),
    exhausts: forecast.valueAtReset >= EXHAUSTION_LEVEL,
    tone: projectionTone(kind, projected, thresholds),
    label: l.t('usage.projected', { value: Math.round(projected) }),
  };
}

export function resetText(resetsAt: number | null, now: number, l: Localizer): string {
  if (resetsAt === null) return l.t('usage.reset.none');
  const remaining = resetsAt - now;
  return remaining <= 0 ? l.t('usage.reset.now') : l.t('usage.reset.in', { span: l.span(remaining) });
}

export function toUsageView(data: UsageData, rangeId: string, l: Localizer, thresholds: UsageThresholds): UsageView {
  const bars = USAGE_WINDOWS.map(({ kind, label }): UsageBarView => {
    const reading = data.snapshot[kind];
    if (reading === null) return { kind, label, percent: '—', fill: 0, tone: 'base', reset: '', projection: null };
    return {
      kind,
      label,
      percent: `${Math.round(reading.utilization)}%`,
      fill: clampPercent(reading.utilization),
      tone: 'base',
      reset: resetText(reading.resetsAt, data.at, l),
      projection: projectionOf(kind, data.forecasts[kind], reading.utilization, thresholds, l),
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
    thresholds,
  );
  return { bars, chart, cycleAvailable: isCycleAvailable(data.snapshot.sevenDay?.resetsAt ?? null, data.at) };
}

export function toUsageErrorView(message: string, claude: ConnectionRowView | undefined): UsageErrorView {
  if (claude === undefined || claude.tone === 'ok' || claude.tone === 'busy') {
    return { message, actions: [] };
  }
  return {
    message: claude.tone === 'error' ? (claude.message ?? message) : message,
    actions: claude.actions.filter((action) => action.kind !== 'disconnect'),
  };
}
