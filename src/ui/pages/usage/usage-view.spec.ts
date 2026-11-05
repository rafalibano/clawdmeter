import { describe, expect, it } from 'vitest';
import type { UsageData } from '../../../application/use-cases';
import { PROBLEM_MESSAGES, actionsFor, errorStatus } from '../../../domain/connections';
import { HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { buildForecasts, createEmptyHistory, type Forecast, type UsageHistory } from '../../../domain/usage';
import { toRowView } from '../../settings/connections/connection-view';
import { usageTone } from './usage-tone';
import { projectionOf, resetText, toUsageErrorView, toUsageView } from './usage-view';

const NOW = new Date(2026, 10, 5, 14, 0).getTime();
const RESET = new Date(2026, 10, 5, 16, 6).getTime();

function dataWith(history: UsageHistory, fiveHour = 40): UsageData {
  const snapshot = {
    fiveHour: { utilization: fiveHour, resetsAt: RESET },
    sevenDay: { utilization: 12.4, resetsAt: NOW + 6 * 24 * HOUR_MS + 2 * HOUR_MS },
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

const ready = (valueAtReset: number): Forecast => ({
  status: 'ready',
  resetsAt: RESET,
  valueAtReset,
  trend: { fromAt: NOW, fromValue: 40, toAt: RESET, toValue: valueAtReset },
  exhaustsAt: valueAtReset >= 100 ? NOW + HOUR_MS : null,
  exhaustsLeadMs: valueAtReset >= 100 ? RESET - NOW - HOUR_MS : null,
});

describe('resetText', () => {
  it('formata o tempo restante curto, sem horário', () => {
    expect(resetText(RESET, NOW)).toBe('reseta em 2h06');
    expect(resetText(NOW + 6 * 24 * HOUR_MS + 2 * HOUR_MS, NOW)).toBe('reseta em 6d2h');
  });

  it('sem janela, e janela que já passou do reset', () => {
    expect(resetText(null, NOW)).toBe('sem janela ativa');
    expect(resetText(NOW - MINUTE_MS, NOW)).toBe('reseta agora');
  });
});

describe('projectionOf', () => {
  it('sem previsão pronta não há trecho', () => {
    expect(projectionOf('fiveHour', { status: 'collecting' }, 40)).toBeNull();
    expect(projectionOf('fiveHour', { status: 'unavailable' }, 40)).toBeNull();
  });

  it('abaixo de 100%: do percentual atual até o previsto no reset', () => {
    expect(projectionOf('fiveHour', ready(78.4), 40)).toEqual({
      from: 40,
      to: 78.4,
      exhausts: false,
      tone: 'base',
      label: 'Projetado 78%',
    });
  });

  it('estoura: o trecho vai até o fim da barra em alerta', () => {
    expect(projectionOf('fiveHour', ready(160), 40)).toEqual({
      from: 40,
      to: 100,
      exhausts: true,
      tone: 'danger',
      label: 'Projetado >100%',
    });
    expect(projectionOf('sevenDay', ready(100), 100)).toMatchObject({ from: 100, to: 100, exhausts: true, tone: 'danger', label: 'Projetado 100%' });
  });

  it('nunca recua abaixo do valor atual', () => {
    expect(projectionOf('fiveHour', ready(30), 40)).toMatchObject({ from: 40, to: 40, exhausts: false, label: 'Projetado 40%' });
  });
});

describe('cor do 7d por faixa', () => {
  it.each([
    [69.9, 'base'],
    [70, 'attention'],
    [89.9, 'attention'],
    [90, 'danger'],
  ])('7d a %s%% fica %s e a 5h sempre base', (value, tone) => {
    expect(usageTone('sevenDay', value)).toBe(tone);
    expect(usageTone('fiveHour', value)).toBe('base');
  });

  it('projetado do 7d segue a faixa do valor projetado; 5h projetada fica verde; estouro fica vermelho', () => {
    expect(projectionOf('sevenDay', ready(69.9), 10)!.tone).toBe('base');
    expect(projectionOf('sevenDay', ready(75), 10)!.tone).toBe('attention');
    expect(projectionOf('sevenDay', ready(95), 10)!.tone).toBe('danger');
    expect(projectionOf('fiveHour', ready(95), 10)!.tone).toBe('base');
    expect(projectionOf('fiveHour', ready(132), 10)).toMatchObject({ tone: 'danger', label: 'Projetado >100%' });
  });

  it('a barra do 7d usa a faixa do percentual atual', () => {
    const data = dataWith(createEmptyHistory());
    const high = { ...data, snapshot: { ...data.snapshot, sevenDay: { utilization: 93, resetsAt: RESET } } };
    expect(toUsageView(high, '1d').bars.map((bar) => bar.tone)).toEqual(['base', 'danger']);
  });

  it('sem projeção a barra não traz legenda', () => {
    const { bars } = toUsageView(dataWith(createEmptyHistory()), '1d');
    expect(bars.every((bar) => bar.projection === null)).toBe(true);
  });
});

describe('toUsageView', () => {
  it('monta as duas barras com percentual, reset curto e trecho previsto só onde há previsão', () => {
    const { bars } = toUsageView(dataWith(ramp((i) => 10 + i)), '6h');
    expect(bars.map((bar) => bar.label)).toEqual(['5h', '7d']);
    expect(bars[0]).toMatchObject({ kind: 'fiveHour', percent: '40%', fill: 40, reset: 'reseta em 2h06' });
    expect(bars[0]!.projection).not.toBeNull();
    expect(bars[1]).toMatchObject({ kind: 'sevenDay', percent: '12%', reset: 'reseta em 6d2h', projection: null });
  });

  it('um gráfico só, com as duas janelas no mesmo eixo de tempo', () => {
    const { chart } = toUsageView(dataWith(ramp((i) => 10 + i)), '6h');
    expect(chart.windows.map((window) => window.label)).toEqual(['5h', '7d']);
    expect(chart.xMin).toBe(NOW - 6 * HOUR_MS);
    expect(chart.windows[0]!.trend?.[0]).toEqual(chart.windows[0]!.points[chart.windows[0]!.points.length - 1]);
    expect(chart.windows[1]!.trend).toBeNull();
  });

  it('o período escolhido recorta a série', () => {
    const history = ramp((i) => 10 + i);
    const hour = toUsageView(dataWith(history), '1h').chart;
    const day = toUsageView(dataWith(history), '1d').chart;
    expect(hour.windows[0]!.points[0]![0]).toBeGreaterThanOrEqual(NOW - HOUR_MS);
    expect(day.xMax).toBeGreaterThan(hour.xMax);
  });

  it('janela ausente na resposta: barra vazia, sem texto', () => {
    const data = dataWith(createEmptyHistory());
    const { bars } = toUsageView({ ...data, snapshot: { fiveHour: null, sevenDay: null } }, '1d');
    expect(bars[0]).toEqual({ kind: 'fiveHour', label: '5h', percent: '—', fill: 0, tone: 'base', reset: '', projection: null });
  });

  it('percentual acima de 100 enche a barra sem passar do trilho', () => {
    const data = dataWith(createEmptyHistory(), 130);
    expect(toUsageView(data, '1d').bars[0]).toMatchObject({ percent: '130%', fill: 100 });
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
