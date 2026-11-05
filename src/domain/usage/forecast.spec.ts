import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../time';
import { buildForecasts, currentCycle, forecastWindow, trendValueAt, type Forecast } from './forecast';
import { linearRegression } from './regression';
import { createEmptyHistory, type UsagePoint } from './usage-history';

const NOW = 1_800_000_000_000;
const RESET = NOW + 2 * HOUR_MS;

function series(count: number, stepMs: number, valueAt: (index: number) => number, resetsAt: number | null = RESET): UsagePoint[] {
  return Array.from({ length: count }, (_, index) => ({
    at: NOW - (count - 1 - index) * stepMs,
    utilization: valueAt(index),
    resetsAt,
  }));
}

function ready(forecast: Forecast) {
  if (forecast.status !== 'ready') throw new Error(`esperava ready, veio ${forecast.status}`);
  return forecast;
}

describe('linearRegression', () => {
  it('ajusta uma reta exata', () => {
    const line = linearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ]);
    expect(line?.slope).toBeCloseTo(2);
    expect(line?.intercept).toBeCloseTo(1);
  });

  it('devolve null com menos de 2 amostras ou x constante', () => {
    expect(linearRegression([{ x: 1, y: 1 }])).toBeNull();
    expect(
      linearRegression([
        { x: 1, y: 1 },
        { x: 1, y: 5 },
      ]),
    ).toBeNull();
  });
});

describe('forecastWindow', () => {
  it('menos de 3 pontos: coletando', () => {
    expect(forecastWindow('fiveHour', series(2, MINUTE_MS, (i) => 10 + i), NOW, RESET)).toEqual({ status: 'collecting' });
    expect(forecastWindow('fiveHour', [], NOW, RESET)).toEqual({ status: 'collecting' });
  });

  it('crescente: projeta a partir do último ponto até o reset', () => {
    const points = series(31, 2 * MINUTE_MS, (i) => 10 + i);
    const forecast = ready(forecastWindow('fiveHour', points, NOW, RESET));
    expect(forecast.trend.fromAt).toBe(NOW);
    expect(forecast.trend.fromValue).toBe(40);
    expect(forecast.trend.toAt).toBe(RESET);
    expect(forecast.valueAtReset).toBeCloseTo(40 + 60, 5);
    expect(forecast.trend.toValue).toBeCloseTo(forecast.valueAtReset, 5);
  });

  it('crescente que estoura: informa quando atinge 100% e a antecedência', () => {
    const points = series(31, 2 * MINUTE_MS, (i) => 50 + i);
    const forecast = ready(forecastWindow('fiveHour', points, NOW, RESET));
    expect(forecast.valueAtReset).toBeGreaterThan(100);
    expect(forecast.exhaustsAt).toBeCloseTo(NOW + 20 * 2 * MINUTE_MS, -2);
    expect(forecast.exhaustsLeadMs).toBeCloseTo(RESET - (forecast.exhaustsAt ?? 0), 5);
  });

  it('estável: previsão igual ao valor atual e sem estouro', () => {
    const points = series(10, MINUTE_MS, () => 37);
    const forecast = ready(forecastWindow('fiveHour', points, NOW, RESET));
    expect(forecast.valueAtReset).toBeCloseTo(37);
    expect(forecast.exhaustsAt).toBeNull();
  });

  it('nunca projeta queda dentro do ciclo', () => {
    const points = series(10, MINUTE_MS, (i) => 40 - i * 0.2);
    const forecast = ready(forecastWindow('fiveHour', points, NOW, RESET));
    expect(forecast.valueAtReset).toBeGreaterThanOrEqual(38.2 - 1e-9);
  });

  it('reset no meio: usa só os pontos depois do reset', () => {
    const oldReset = NOW - 30 * MINUTE_MS;
    const before = series(20, MINUTE_MS, (i) => 80 + i, oldReset).map((point) => ({ ...point, at: point.at - 60 * MINUTE_MS }));
    const after = series(5, MINUTE_MS, (i) => 2 + i * 0.5, RESET);
    const forecast = ready(forecastWindow('fiveHour', [...before, ...after], NOW, RESET));
    expect(forecast.trend.fromValue).toBe(4);
    expect(forecast.valueAtReset).toBeLessThan(100);
  });

  it('reset no meio com menos de 3 pontos novos: coletando', () => {
    const before = series(20, MINUTE_MS, (i) => 80 + i, NOW - HOUR_MS).map((point) => ({ ...point, at: point.at - 30 * MINUTE_MS }));
    const after = series(2, MINUTE_MS, (i) => 1 + i, RESET);
    expect(forecastWindow('fiveHour', [...before, ...after], NOW, RESET)).toEqual({ status: 'collecting' });
  });

  it('queda de utilização sem mudança de resets_at também marca novo ciclo', () => {
    const points = [
      ...series(5, MINUTE_MS, (i) => 90 + i).map((point) => ({ ...point, at: point.at - 10 * MINUTE_MS })),
      ...series(5, MINUTE_MS, (i) => 3 + i),
    ];
    expect(currentCycle(points)).toHaveLength(5);
  });

  it('transição entre resets_at nulo e preenchido abre novo ciclo', () => {
    const idle = series(3, MINUTE_MS, () => 0, null).map((point) => ({ ...point, at: point.at - 5 * MINUTE_MS }));
    const active = series(3, MINUTE_MS, (i) => i, RESET);
    expect(currentCycle([...idle, ...active])).toHaveLength(3);
  });

  it('ponto importado (sem resets_at) ao lado de ponto nosso não cria ciclo falso, nos dois sentidos', () => {
    const imported = series(4, MINUTE_MS, (i) => 10 + i, null).map((point) => ({ ...point, imported: true as const }));
    const earlier = (points: UsagePoint[]) => points.map((point) => ({ ...point, at: point.at - 10 * MINUTE_MS }));
    const ours = series(4, MINUTE_MS, (i) => 14 + i, RESET);
    const lateImported = imported.map((point) => ({ ...point, utilization: point.utilization + 10 }));
    expect(currentCycle([...earlier(imported), ...ours])).toHaveLength(8);
    expect(currentCycle([...earlier(ours), ...lateImported])).toHaveLength(8);
  });

  it('queda de utilização continua abrindo ciclo entre pontos importados', () => {
    const before = series(4, MINUTE_MS, (i) => 90 + i, null).map((point) => ({ ...point, at: point.at - 10 * MINUTE_MS, imported: true as const }));
    const after = series(4, MINUTE_MS, (i) => 2 + i, null).map((point) => ({ ...point, imported: true as const }));
    expect(currentCycle([...before, ...after])).toHaveLength(4);
  });

  it('previsão usa pontos importados do ciclo atual', () => {
    const imported = series(6, MINUTE_MS * 10, (i) => 10 + i * 2, null).map((point) => ({ ...point, imported: true as const }));
    const ours = series(3, MINUTE_MS, (i) => 30 + i, RESET).map((point) => ({ ...point, at: point.at + 5 * MINUTE_MS }));
    const forecast = forecastWindow('fiveHour', [...imported, ...ours], NOW + 5 * MINUTE_MS, RESET);
    expect(forecast.status).toBe('ready');
  });

  it('oscilação pequena de resets_at não conta como reset', () => {
    const points = series(10, MINUTE_MS, (i) => 10 + i).map((point, index) => ({ ...point, resetsAt: RESET + index * 100 }));
    expect(currentCycle(points)).toHaveLength(10);
  });

  it('janela de regressão: 1h no 5h e 24h no semanal', () => {
    const flatThenSteep = [
      ...series(60, 10 * MINUTE_MS, () => 10).map((point) => ({ ...point, at: point.at - 2 * HOUR_MS })),
      ...series(7, 10 * MINUTE_MS, (i) => 10 + i * 5),
    ];
    const hourly = ready(forecastWindow('fiveHour', flatThenSteep, NOW, RESET));
    const daily = ready(forecastWindow('sevenDay', flatThenSteep, NOW, NOW + DAY_MS));
    expect(hourly.valueAtReset).toBeGreaterThan(daily.valueAtReset);
  });

  it('sem resets_at ou reset no passado: indisponível', () => {
    const points = series(10, MINUTE_MS, (i) => i);
    expect(forecastWindow('fiveHour', points, NOW, null)).toEqual({ status: 'unavailable' });
    expect(forecastWindow('fiveHour', points, NOW, NOW - 1)).toEqual({ status: 'unavailable' });
  });

  it('já em 100%: previsão de 100% sem horário de estouro', () => {
    const points = series(10, MINUTE_MS, (i) => 98 + i * 0.3);
    const forecast = ready(forecastWindow('fiveHour', points, NOW, RESET));
    expect(forecast.exhaustsAt).toBeNull();
    expect(forecast.valueAtReset).toBeGreaterThanOrEqual(100);
  });
});

describe('trendValueAt', () => {
  it('interpola entre o último ponto e o reset', () => {
    const trend = { fromAt: 0, fromValue: 10, toAt: 100, toValue: 50 };
    expect(trendValueAt(trend, 50)).toBe(30);
    expect(trendValueAt({ ...trend, toAt: 0 }, 50)).toBe(10);
  });
});

describe('buildForecasts', () => {
  it('calcula as duas janelas; janela sem pontos no histórico fica coletando dados', () => {
    const history = { ...createEmptyHistory(), fiveHour: series(10, MINUTE_MS, (i) => i) };
    const forecasts = buildForecasts(history, { fiveHour: { utilization: 9, resetsAt: RESET }, sevenDay: null }, NOW);
    expect(forecasts.fiveHour.status).toBe('ready');
    expect(forecasts.sevenDay.status).toBe('collecting');
  });
});
