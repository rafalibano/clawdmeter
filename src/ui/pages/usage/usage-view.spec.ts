import { describe, expect, it } from 'vitest';
import { ProjectUsage, type UsageData } from '../../../application/use-cases';
import { actionsFor, errorStatus } from '../../../domain/connections';
import { HOUR_MS, MINUTE_MS } from '../../../domain/time';
import { createEmptyHistory, type Forecast, type ProjectionMethod, type UsageHistory } from '../../../domain/usage';
import { toRowView } from '../../settings/connections/connection-view';
import { Localizer } from '../../i18n';
import {
  projectionOf as projectionWith,
  resetText as resetTextWith,
  toUsageErrorView,
  toUsageView as toUsageViewWith,
} from './usage-view';

const PT = new Localizer('pt-BR');
const projectionOf = (forecast: Forecast, current: number, l = PT) => projectionWith(forecast, current, l);
const resetText = (resetsAt: number | null, now: number, l = PT) => resetTextWith(resetsAt, now, l);
const toUsageView = (data: UsageData, rangeId: string, method: ProjectionMethod = '14d', l = PT) =>
  toUsageViewWith(data, rangeId, l, method);

const NOW = new Date(2026, 10, 5, 14, 0).getTime();
const RESET = new Date(2026, 10, 5, 16, 6).getTime();

function dataWith(history: UsageHistory, fiveHour = 40): UsageData {
  const snapshot = {
    fiveHour: { utilization: fiveHour, resetsAt: RESET },
    sevenDay: { utilization: 12.4, resetsAt: NOW + 6 * 24 * HOUR_MS + 2 * HOUR_MS },
  };
  return { at: NOW, snapshot, history };
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
  ratePerDay: 0,
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
    expect(projectionOf({ status: 'collecting' }, 40)).toBeNull();
    expect(projectionOf({ status: 'unavailable' }, 40)).toBeNull();
  });

  it('abaixo de 100%: uma linha vertical no percentual projetado', () => {
    expect(projectionOf(ready(78.4), 40)).toEqual({
      at: 78.4,
      exhausts: false,
      alert: false,
      label: 'Projetado 78%',
    });
  });

  it('estoura: a linha fica no fim da barra, em vermelho, e a legenda traz o número real', () => {
    expect(projectionOf(ready(132), 40)).toEqual({
      at: 100,
      exhausts: true,
      alert: true,
      label: 'Projetado 132%',
    });
    expect(projectionOf(ready(100), 100)).toMatchObject({ at: 100, exhausts: true, alert: true, label: 'Projetado 100%' });
    expect(projectionOf(ready(160), 40)!.label).not.toContain('>');
  });

  it('nunca recua abaixo do valor atual', () => {
    expect(projectionOf(ready(30), 40)).toMatchObject({ at: 40, exhausts: false, label: 'Projetado 40%' });
  });

  it('a legenda segue a língua', () => {
    expect(projectionOf(ready(132), 40, new Localizer('en'))!.label).toBe('Projected 132%');
    expect(projectionOf(ready(132), 40, new Localizer('es-MX'))!.label).toBe('Proyectado 132%');
  });
});

describe('alerta da projeção', () => {
  it('só o texto alerta, a partir de 100% projetado', () => {
    expect(projectionOf(ready(99.9), 10)!.alert).toBe(false);
    expect(projectionOf(ready(100), 10)!.alert).toBe(true);
    expect(projectionOf(ready(132), 10)!.alert).toBe(true);
  });

  it('sem projeção a barra não traz legenda', () => {
    const data = dataWith(createEmptyHistory());
    const idle = { fiveHour: { utilization: 40, resetsAt: null }, sevenDay: { utilization: 12, resetsAt: null } };
    const { bars } = toUsageView({ ...data, snapshot: idle }, '1d');
    expect(bars.every((bar) => bar.projection === null)).toBe(true);
  });
});

describe('método de projeção nas barras e no gráfico', () => {
  const DAY = 24 * HOUR_MS;
  const weekly = (): UsageHistory => ({
    fiveHour: [],
    sevenDay: [
      { at: NOW - 4 * DAY, utilization: 2, resetsAt: null },
      { at: NOW - 2 * DAY, utilization: 8, resetsAt: null },
      { at: NOW, utilization: 12.4, resetsAt: null },
    ],
  });

  it('trocar o método muda a projeção do 7d nas barras e no gráfico, e o 5h não muda', () => {
    const byDays = toUsageView(dataWith(weekly()), '7d', '14d');
    const bySince = toUsageView(dataWith(weekly()), '7d', 'since-reset');
    expect(byDays.bars[1]!.projection!.label).not.toBe(bySince.bars[1]!.projection!.label);
    expect(byDays.chart.windows[1]!.trend![1]![1]).not.toBe(bySince.chart.windows[1]!.trend![1]![1]);
    expect(byDays.bars[0]!.projection).toEqual(bySince.bars[0]!.projection);
    expect(byDays.chart.windows[0]!.trend).toEqual(bySince.chart.windows[0]!.trend);
  });

  it('a mesma regra vale em todos os períodos e no Ciclo (mesma inclinação da linha)', () => {
    const slope = (range: string, method: ProjectionMethod) => {
      const trend = toUsageView(dataWith(weekly()), range, method).chart.windows[1]!.trend!;
      return ((trend[1]![1] - trend[0]![1]) / (trend[1]![0] - trend[0]![0])) * DAY;
    };
    for (const range of ['7d', '30d', 'cycle']) {
      expect(slope(range, '14d')).toBeCloseTo(((8 - 2 + (12.4 - 8)) / 4), 5);
      expect(slope(range, 'since-reset')).toBeCloseTo((12.4 / 22) * 24, 5);
    }
  });
});

describe('consistência: uma só projeção para barra, linha e tooltip', () => {
  const DAY = 24 * HOUR_MS;
  const history = (): UsageHistory => ({
    fiveHour: [],
    sevenDay: [
      { at: NOW - 4 * DAY, utilization: 2, resetsAt: null },
      { at: NOW - 2 * DAY, utilization: 8, resetsAt: null },
      { at: NOW - 20 * HOUR_MS, utilization: 9, resetsAt: null },
      { at: NOW - 10 * HOUR_MS, utilization: 11.5, resetsAt: null },
      { at: NOW, utilization: 12.4, resetsAt: null },
    ],
  });

  for (const method of ['24h', '14d', 'since-reset'] as const) {
    it(`${method}: o último ponto da linha no reset (Ciclo, sem cap) é o valueAtReset da barra`, () => {
      const data = dataWith(history());
      const forecasts = new ProjectUsage().execute(data.history, data.snapshot, data.at, method);
      const weekly = forecasts.sevenDay;
      if (weekly.status !== 'ready') throw new Error('esperava projeção pronta');
      const view = toUsageView(data, 'cycle', method);
      const trend = view.chart.windows[1]!.trend!;
      expect(trend[1]![0]).toBe(weekly.resetsAt);
      expect(trend[1]![1]).toBeCloseTo(weekly.valueAtReset, 9);
      expect(view.chart.windows[1]!.projectAt!(weekly.resetsAt)).toBeCloseTo(weekly.valueAtReset, 9);
      expect(view.bars[1]!.projection!.label).toBe(`Projetado ${Math.round(Math.max(weekly.valueAtReset, 12.4))}%`);
      expect(Math.round(trend[1]![1])).toBe(Math.round(weekly.valueAtReset));
      expect(trend[1]![1] - trend[0]![1]).toBeCloseTo((weekly.ratePerDay * (weekly.resetsAt - NOW)) / DAY, 9);
    });

    it(`${method}: o 5h na barra e na linha também vêm da mesma projeção`, () => {
      const data = dataWith(history());
      const five = new ProjectUsage().execute(data.history, data.snapshot, data.at, method).fiveHour;
      if (five.status !== 'ready') throw new Error('esperava projeção pronta');
      const view = toUsageView(data, '6h', method);
      const trend = view.chart.windows[0]!.trend!;
      expect(view.bars[0]!.projection!.label).toBe(`Projetado ${Math.round(Math.max(five.valueAtReset, 40))}%`);
      expect(trend[0]).toEqual([NOW, 40]);
      expect(five.valueAtReset).toBeGreaterThan(40);
    });
  }

  it('os três métodos dão projeções diferentes no 7d, mas o 5h é igual', () => {
    const data = dataWith(history());
    const run = (method: ProjectionMethod) => new ProjectUsage().execute(data.history, data.snapshot, data.at, method);
    const values = (['24h', '14d', 'since-reset'] as const).map((method) => {
      const weekly = run(method).sevenDay;
      return weekly.status === 'ready' ? weekly.valueAtReset : null;
    });
    expect(new Set(values).size).toBe(3);
    expect(run('24h').fiveHour).toEqual(run('14d').fiveHour);
    expect(run('14d').fiveHour).toEqual(run('since-reset').fiveHour);
  });
});

describe('toUsageView', () => {
  it('monta as duas barras com percentual, reset curto e trecho previsto só onde há previsão', () => {
    const { bars } = toUsageView(dataWith(ramp((i) => 10 + i)), '6h');
    expect(bars.map((bar) => bar.label)).toEqual(['5h', '7d']);
    expect(bars[0]).toMatchObject({ kind: 'fiveHour', percent: '40%', fill: 40, reset: 'reseta em 2h06' });
    expect(bars[0]!.projection).not.toBeNull();
    expect(bars[1]).toMatchObject({ kind: 'sevenDay', percent: '12%', reset: 'reseta em 6d2h' });
    expect(bars[1]!.projection).not.toBeNull();
  });

  it('um gráfico só, com as duas janelas no mesmo eixo de tempo', () => {
    const { chart } = toUsageView(dataWith(ramp((i) => 10 + i)), '6h');
    expect(chart.windows.map((window) => window.label)).toEqual(['5h', '7d']);
    expect(chart.xMin).toBe(NOW - 6 * HOUR_MS);
    const last = chart.windows[0]!.points[chart.windows[0]!.points.length - 1]!;
    const trendStart = chart.windows[0]!.trend![0]![0];
    expect(trendStart).toBeGreaterThanOrEqual(last[0]);
    expect(trendStart - last[0]).toBeLessThan((6 * HOUR_MS) / 120);
    expect(chart.windows[1]!.trend).not.toBeNull();
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
    expect(bars[0]).toEqual({ kind: 'fiveHour', label: '5h', percent: '—', fill: 0, reset: '', projection: null });
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
