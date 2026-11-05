import { describe, expect, it } from 'vitest';
import type { UsageData } from '../../../application/use-cases';
import { PROBLEM_MESSAGES, actionsFor, errorStatus } from '../../../domain/connections';
import { HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { buildForecasts, createEmptyHistory, type Forecast, type UsageHistory } from '../../../domain/usage';
import { toRowView } from '../../settings/connections/connection-view';
import { forecastText, toUsageErrorView, toUsageView } from './usage-view';

const NOW = new Date(2026, 10, 5, 14, 0).getTime();
const RESET = new Date(2026, 10, 5, 17, 0).getTime();

function dataWith(history: UsageHistory, fiveHour = 40): UsageData {
  const snapshot = {
    fiveHour: { utilization: fiveHour, resetsAt: RESET },
    sevenDay: { utilization: 12.4, resetsAt: NOW + 3 * 24 * HOUR_MS },
  };
  return { at: NOW, snapshot, history, forecasts: buildForecasts(history, snapshot, NOW) };
}

function ramp(valueAt: (index: number) => number): UsageHistory {
  const points = Array.from({ length: 31 }, (_, index) => ({
    at: NOW - (30 - index) * 2 * MINUTE_MS,
    utilization: valueAt(index),
    resetsAt: RESET,
  }));
  return { fiveHour: points, sevenDay: [] };
}

describe('forecastText', () => {
  const base = { status: 'ready', resetsAt: RESET, trend: { fromAt: NOW, fromValue: 40, toAt: RESET, toValue: 78 } } as const;

  it('coletando dados com menos de 3 pontos', () => {
    expect(forecastText({ status: 'collecting' }, NOW)).toEqual({ text: 'Previsão: coletando dados…', tone: 'muted' });
  });

  it('abaixo de 100%: valor aproximado no horário do reset', () => {
    const forecast: Forecast = { ...base, valueAtReset: 78.4, exhaustsAt: null, exhaustsLeadMs: null };
    expect(forecastText(forecast, NOW)).toEqual({ text: 'Previsão no reset (17:00): ~78%', tone: 'ok' });
  });

  it('perto do limite: tom de alerta', () => {
    const forecast: Forecast = { ...base, valueAtReset: 91, exhaustsAt: null, exhaustsLeadMs: null };
    expect(forecastText(forecast, NOW).tone).toBe('warn');
  });

  it('estouro: informa o horário e a antecedência', () => {
    const exhaustsAt = new Date(2026, 10, 5, 15, 40).getTime();
    const forecast: Forecast = { ...base, valueAtReset: 160, exhaustsAt, exhaustsLeadMs: RESET - exhaustsAt };
    expect(forecastText(forecast, NOW)).toEqual({
      text: 'Previsão no reset (17:00): 100% · estoura às 15:40, 1h20 antes',
      tone: 'danger',
    });
  });

  it('já no limite: sem horário de estouro', () => {
    const forecast: Forecast = { ...base, valueAtReset: 100, exhaustsAt: null, exhaustsLeadMs: null };
    expect(forecastText(forecast, NOW).text).toBe('Previsão no reset (17:00): 100% · limite já atingido');
  });

  it('janela sem reset conhecido', () => {
    expect(forecastText({ status: 'unavailable' }, NOW).tone).toBe('muted');
  });
});

describe('toUsageView', () => {
  it('monta as duas janelas com valor atual, reset e previsão', () => {
    const [five, week] = toUsageView(dataWith(ramp((i) => 10 + i)), '12h');
    expect(five).toMatchObject({
      kind: 'fiveHour',
      title: 'Janela de 5 horas',
      current: '40%',
      reset: 'Reseta às 17:00 (em 3h)',
      hasData: true,
    });
    expect(five?.forecast).toMatch(/^Previsão no reset \(17:00\): /);
    expect(week).toMatchObject({ kind: 'sevenDay', current: '12%', forecast: 'Previsão: coletando dados…' });
    expect(week?.reset).toMatch(/^Reseta às (dom|seg|ter|qua|qui|sex|sáb) 14:00 \(em 3d\)$/);
  });

  it('o período escolhido recorta a série e a tendência parte do último ponto real', () => {
    const history = ramp((i) => 10 + i);
    const hour = toUsageView(dataWith(history), '1h')[0]!;
    const day = toUsageView(dataWith(history), '1d')[0]!;
    expect(hour.chart.series.length).toBe(31);
    expect(hour.chart.series[0]![0]).toBeGreaterThanOrEqual(NOW - HOUR_MS);
    expect(hour.chart.trend?.[0]).toEqual(hour.chart.series[hour.chart.series.length - 1]);
    expect(day.chart.xMax).toBeGreaterThan(hour.chart.xMax);
  });

  it('janela ausente na resposta', () => {
    const data = dataWith(createEmptyHistory());
    const view = toUsageView({ ...data, snapshot: { fiveHour: null, sevenDay: null } }, '1d')[0]!;
    expect(view).toMatchObject({ hasData: false, current: '—', reset: 'Sem dados desta janela' });
  });

  it('janela sem resets_at: sem janela ativa', () => {
    const data = dataWith(createEmptyHistory());
    const view = toUsageView({ ...data, snapshot: { fiveHour: { utilization: 0, resetsAt: null }, sevenDay: null } }, '1d')[0]!;
    expect(view.reset).toBe('Sem janela ativa');
  });
});

describe('toUsageErrorView', () => {
  it('401: mostra a mensagem da conexão e o botão "Refazer login do Claude"', () => {
    const status = errorStatus('claude-expired');
    const row = toRowView('claude', status);
    const view = toUsageErrorView('claude-expired', row);
    expect(view.message).toBe(PROBLEM_MESSAGES['claude-expired']);
    expect(view.actions.map((action) => action.label)).toEqual(['Refazer login do Claude', 'Verificar de novo']);
    expect(actionsFor('claude', status).some((action) => action.kind === 'disconnect')).toBe(true);
    expect(view.actions.some((action) => action.kind === 'disconnect')).toBe(false);
  });

  it('desconectado: oferece Conectar', () => {
    const view = toUsageErrorView('Claude desconectado.', toRowView('claude', { state: 'disconnected' }));
    expect(view.actions.map((action) => action.label)).toEqual(['Conectar']);
  });

  it('erro de rede com a conexão ok: só a mensagem, sem botão', () => {
    const view = toUsageErrorView('Anthropic respondeu 500', toRowView('claude', { state: 'connected' }));
    expect(view).toEqual({ message: 'Anthropic respondeu 500', actions: [] });
    expect(toUsageErrorView('x', undefined)).toEqual({ message: 'x', actions: [] });
  });
});
