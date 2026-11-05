import { describe, expect, it } from 'vitest';
import type { UsageData } from '../../../application/use-cases';
import { actionsFor, errorStatus } from '../../../domain/connections';
import { HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { buildForecasts, createEmptyHistory, type Forecast, type UsageHistory, type UsageWindowKind } from '../../../domain/usage';
import { toRowView } from '../../settings/connections/connection-view';
import { Localizer } from '../../i18n';
import { projectionTone } from './usage-tone';
import {
  projectionOf as projectionWith,
  resetText as resetTextWith,
  toUsageErrorView,
  toUsageView as toUsageViewWith,
} from './usage-view';

const PT = new Localizer('pt-BR');
const THRESHOLDS = { warning: 70, critical: 90 };
const projectionOf = (kind: UsageWindowKind, forecast: Forecast, current: number, thresholds = THRESHOLDS, l = PT) =>
  projectionWith(kind, forecast, current, thresholds, l);
const resetText = (resetsAt: number | null, now: number, l = PT) => resetTextWith(resetsAt, now, l);
const toUsageView = (data: UsageData, rangeId: string, thresholds = THRESHOLDS, l = PT) => toUsageViewWith(data, rangeId, l, thresholds);

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
  it('sem previsão pronta não há marca', () => {
    expect(projectionOf('fiveHour', { status: 'collecting' }, 40)).toBeNull();
    expect(projectionOf('fiveHour', { status: 'unavailable' }, 40)).toBeNull();
  });

  it('abaixo de 100%: uma linha vertical no percentual projetado', () => {
    expect(projectionOf('fiveHour', ready(78.4), 40)).toEqual({
      at: 78.4,
      exhausts: false,
      tone: 'base',
      label: 'Projetado 78%',
    });
  });

  it('estoura: a linha fica no fim da barra, em vermelho, e a legenda traz o número real', () => {
    expect(projectionOf('fiveHour', ready(132), 40)).toEqual({
      at: 100,
      exhausts: true,
      tone: 'danger',
      label: 'Projetado 132%',
    });
    expect(projectionOf('sevenDay', ready(100), 100)).toMatchObject({ at: 100, exhausts: true, tone: 'danger', label: 'Projetado 100%' });
    expect(projectionOf('fiveHour', ready(160), 40)!.label).not.toContain('>');
  });

  it('nunca recua abaixo do valor atual', () => {
    expect(projectionOf('fiveHour', ready(30), 40)).toMatchObject({ at: 40, exhausts: false, label: 'Projetado 40%' });
  });

  it('a legenda segue a língua', () => {
    expect(projectionOf('fiveHour', ready(132), 40, THRESHOLDS, new Localizer('en'))!.label).toBe('Projected 132%');
    expect(projectionOf('fiveHour', ready(132), 40, THRESHOLDS, new Localizer('es-MX'))!.label).toBe('Proyectado 132%');
  });
});

describe('cor da projeção por faixa', () => {
  it.each([
    [69.9, 'base'],
    [70, 'attention'],
    [89.9, 'attention'],
    [90, 'danger'],
    [100, 'danger'],
    [140, 'danger'],
  ])('7d projetado a %s%% fica %s', (value, tone) => {
    expect(projectionTone('sevenDay', value, THRESHOLDS)).toBe(tone);
  });

  it('a 5h projetada fica verde (base) e só vira vermelha a partir de 100%', () => {
    expect(projectionTone('fiveHour', 99, THRESHOLDS)).toBe('base');
    expect(projectionTone('fiveHour', 100, THRESHOLDS)).toBe('danger');
    expect(projectionTone('fiveHour', 95, { warning: 10, critical: 20 })).toBe('base');
  });

  it('os limiares editáveis movem as faixas do 7d', () => {
    expect(projectionTone('sevenDay', 55, { warning: 50, critical: 60 })).toBe('attention');
    expect(projectionTone('sevenDay', 60, { warning: 50, critical: 60 })).toBe('danger');
    expect(projectionTone('sevenDay', 75, { warning: 80, critical: 95 })).toBe('base');
  });

  it('projetado do 7d usa a faixa do valor projetado; 5h verde; estouro vermelho', () => {
    expect(projectionOf('sevenDay', ready(69.9), 10)!.tone).toBe('base');
    expect(projectionOf('sevenDay', ready(75), 10)!.tone).toBe('attention');
    expect(projectionOf('sevenDay', ready(95), 10)!.tone).toBe('danger');
    expect(projectionOf('fiveHour', ready(95), 10)!.tone).toBe('base');
    expect(projectionOf('fiveHour', ready(132), 10)).toMatchObject({ tone: 'danger', label: 'Projetado 132%' });
    expect(projectionOf('sevenDay', ready(75), 10, { warning: 80, critical: 95 })!.tone).toBe('base');
  });

  it('a barra de consumo atual é sempre neutra, mesmo com 7d em 93%', () => {
    const data = dataWith(createEmptyHistory());
    const high = { ...data, snapshot: { ...data.snapshot, sevenDay: { utilization: 93, resetsAt: RESET } } };
    expect(toUsageView(high, '1d').bars.map((bar) => bar.tone)).toEqual(['base', 'base']);
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

  it('o seletor Reset só fica disponível com reset semanal conhecido', () => {
    const data = dataWith(createEmptyHistory());
    expect(toUsageView(data, 'cycle').cycleAvailable).toBe(true);
    const unknown = { ...data, snapshot: { ...data.snapshot, sevenDay: { utilization: 12, resetsAt: null } } };
    expect(toUsageView(unknown, 'cycle').cycleAvailable).toBe(false);
    expect(toUsageView({ ...data, snapshot: { fiveHour: null, sevenDay: null } }, 'cycle').cycleAvailable).toBe(false);
  });

  it('o período Reset monta o eixo do último reset semanal até o próximo', () => {
    const { chart } = toUsageView(dataWith(ramp((i) => 10 + i)), 'cycle');
    const weeklyReset = NOW + 6 * 24 * HOUR_MS + 2 * HOUR_MS;
    expect(chart).toMatchObject({ cycle: true, xMin: weeklyReset - 7 * 24 * HOUR_MS, xMax: weeklyReset });
  });

  it('percentual acima de 100 enche a barra sem passar do trilho', () => {
    const data = dataWith(createEmptyHistory(), 130);
    expect(toUsageView(data, '1d').bars[0]).toMatchObject({ percent: '130%', fill: 100 });
  });
});

describe('toUsageErrorView', () => {
  it('401: mostra a mensagem da conexão e o botão "Refazer login do Claude"', () => {
    const status = errorStatus('claude-expired');
    const row = toRowView('claude', status, PT);
    const view = toUsageErrorView('claude-expired', row);
    expect(view.message).toBe('Token vencido — abra o Claude Code para renová-lo ou refaça o login.');
    expect(view.actions.map((action) => action.label)).toEqual(['relogin-claude', 'recheck']);
    expect(actionsFor('claude', status).some((action) => action.kind === 'disconnect')).toBe(true);
    expect(view.actions.some((action) => action.kind === 'disconnect')).toBe(false);
  });

  it('desconectado: oferece Conectar', () => {
    const view = toUsageErrorView('Claude desconectado.', toRowView('claude', { state: 'disconnected' }, PT));
    expect(view.actions.map((action) => action.label)).toEqual(['connect']);
  });

  it('erro de rede com a conexão ok: só a mensagem, sem botão', () => {
    const view = toUsageErrorView('Anthropic respondeu 500', toRowView('claude', { state: 'connected' }, PT));
    expect(view).toEqual({ message: 'Anthropic respondeu 500', actions: [] });
    expect(toUsageErrorView('x', undefined)).toEqual({ message: 'x', actions: [] });
  });
});
