import type { ConnectionAction } from '../../../domain/connections';
import {
  EXHAUSTION_LEVEL,
  USAGE_WINDOWS,
  usageRange,
  type Forecast,
  type UsageWindowKind,
} from '../../../domain/usage';
import type { UsageData } from '../../../application/use-cases';
import { formatDayClock, formatSpan } from '../../format/time';
import type { ConnectionRowView } from '../../settings/connections/connection-view';
import { buildChartModel, type UsageChartModel } from './usage-chart-model';

export type ForecastTone = 'muted' | 'ok' | 'warn' | 'danger';

export interface UsageWindowView {
  kind: UsageWindowKind;
  title: string;
  hasData: boolean;
  current: string;
  reset: string;
  forecast: string;
  tone: ForecastTone;
  chart: UsageChartModel;
}

export interface UsageErrorView {
  message: string;
  actions: ConnectionAction[];
}

const WARN_LEVEL = 80;

export function forecastText(forecast: Forecast, now: number): { text: string; tone: ForecastTone } {
  switch (forecast.status) {
    case 'collecting':
      return { text: 'Previsão: coletando dados…', tone: 'muted' };
    case 'unavailable':
      return { text: 'Previsão indisponível: sem janela ativa.', tone: 'muted' };
    case 'ready': {
      const prefix = `Previsão no reset (${formatDayClock(forecast.resetsAt, now)}):`;
      if (forecast.valueAtReset < EXHAUSTION_LEVEL) {
        const tone = forecast.valueAtReset >= WARN_LEVEL ? 'warn' : 'ok';
        return { text: `${prefix} ~${Math.round(forecast.valueAtReset)}%`, tone };
      }
      if (forecast.exhaustsAt === null || forecast.exhaustsLeadMs === null) {
        return { text: `${prefix} ${EXHAUSTION_LEVEL}% · limite já atingido`, tone: 'danger' };
      }
      const when = formatDayClock(forecast.exhaustsAt, now);
      const lead = formatSpan(forecast.exhaustsLeadMs);
      return { text: `${prefix} ${EXHAUSTION_LEVEL}% · estoura às ${when}, ${lead} antes`, tone: 'danger' };
    }
  }
}

function resetText(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return 'Sem janela ativa';
  const remaining = resetsAt - now;
  const at = formatDayClock(resetsAt, now);
  return remaining <= 0 ? `Reset às ${at}` : `Reseta às ${at} (em ${formatSpan(remaining)})`;
}

export function toUsageView(data: UsageData, rangeId: string): UsageWindowView[] {
  const range = usageRange(rangeId);
  return USAGE_WINDOWS.map(({ kind, label }) => {
    const reading = data.snapshot[kind];
    const forecast = forecastText(data.forecasts[kind], data.at);
    return {
      kind,
      title: label,
      hasData: reading !== null,
      current: reading === null ? '—' : `${Math.round(reading.utilization)}%`,
      reset: reading === null ? 'Sem dados desta janela' : resetText(reading.resetsAt, data.at),
      forecast: forecast.text,
      tone: forecast.tone,
      chart: buildChartModel(data.history[kind], data.forecasts[kind], range, data.at),
    };
  });
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
