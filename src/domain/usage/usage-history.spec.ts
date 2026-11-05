import { describe, expect, it } from 'vitest';
import { createEmptyHistory, parseHistory, recordSnapshot, serializeHistory } from './usage-history';
import { pointsInRange, usageRange, USAGE_RANGES } from './usage-range';
import { HOUR_MS } from '../time';

describe('recordSnapshot', () => {
  it('acrescenta um ponto por janela presente', () => {
    const history = recordSnapshot(createEmptyHistory(), { fiveHour: { utilization: 10, resetsAt: 5 }, sevenDay: null }, 100);
    expect(history.fiveHour).toEqual([{ at: 100, utilization: 10, resetsAt: 5 }]);
    expect(history.sevenDay).toEqual([]);
  });

  it('não muta o histórico anterior e mantém a ordem', () => {
    const base = recordSnapshot(createEmptyHistory(), { fiveHour: { utilization: 1, resetsAt: null }, sevenDay: null }, 200);
    const next = recordSnapshot(base, { fiveHour: { utilization: 2, resetsAt: null }, sevenDay: null }, 300);
    expect(base.fiveHour).toHaveLength(1);
    expect(next.fiveHour.map((point) => point.at)).toEqual([200, 300]);
  });

  it('timestamp repetido substitui o ponto; fora de ordem reordena', () => {
    let history = recordSnapshot(createEmptyHistory(), { fiveHour: { utilization: 1, resetsAt: null }, sevenDay: null }, 200);
    history = recordSnapshot(history, { fiveHour: { utilization: 9, resetsAt: null }, sevenDay: null }, 200);
    history = recordSnapshot(history, { fiveHour: { utilization: 5, resetsAt: null }, sevenDay: null }, 100);
    expect(history.fiveHour.map((point) => [point.at, point.utilization])).toEqual([
      [100, 5],
      [200, 9],
    ]);
  });
});

describe('serialização', () => {
  it('ida e volta preserva os pontos', () => {
    const history = {
      fiveHour: [{ at: 1, utilization: 2.5, resetsAt: 9 }],
      sevenDay: [{ at: 3, utilization: 4, resetsAt: null }],
    };
    expect(parseHistory(JSON.parse(JSON.stringify(serializeHistory(history))))).toEqual(history);
  });

  it('a marca de importado sobrevive à ida e volta e pontos antigos continuam válidos', () => {
    const history = {
      fiveHour: [
        { at: 1, utilization: 2, resetsAt: null, imported: true as const },
        { at: 2, utilization: 3, resetsAt: 9 },
      ],
      sevenDay: [],
    };
    expect(parseHistory(JSON.parse(JSON.stringify(serializeHistory(history))))).toEqual(history);
    expect(parseHistory({ fiveHour: [[5, 1, null, 0]], sevenDay: [] }).fiveHour).toEqual([{ at: 5, utilization: 1, resetsAt: null }]);
  });

  it('parse tolerante: lixo vira histórico vazio ou descarta entradas inválidas', () => {
    expect(parseHistory(null)).toEqual(createEmptyHistory());
    expect(parseHistory({ fiveHour: 'x' })).toEqual(createEmptyHistory());
    const parsed = parseHistory({ fiveHour: [[2, 5, null], 'x', [1, 'a', null], [1, 3, 'z'], [NaN, 1, null]], sevenDay: [] });
    expect(parsed.fiveHour).toEqual([
      { at: 1, utilization: 3, resetsAt: null },
      { at: 2, utilization: 5, resetsAt: null },
    ]);
  });
});

describe('seletor de período', () => {
  it('oferece 1h, 6h, 1d, 7d, 30d e o ciclo semanal', () => {
    expect(USAGE_RANGES.map((range) => range.id)).toEqual(['1h', '6h', '1d', '7d', '30d', 'cycle']);
  });

  it('id desconhecido cai no primeiro período', () => {
    expect(usageRange('x').id).toBe('1h');
  });

  it('recorta os pontos do período até agora', () => {
    const points = [3, 2, 1, 0].map((hours) => ({ at: 10 * HOUR_MS - hours * HOUR_MS, utilization: hours, resetsAt: null }));
    expect(pointsInRange(points, usageRange('1h'), 10 * HOUR_MS).map((point) => point.utilization)).toEqual([1, 0]);
    expect(pointsInRange(points, usageRange('1h'), 9.5 * HOUR_MS).map((point) => point.utilization)).toEqual([1]);
  });
});
