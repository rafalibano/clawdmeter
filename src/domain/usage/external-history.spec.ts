import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../time';
import {
  EXTERNAL_DEDUPE_TOLERANCE_MS,
  mergeExternalPoints,
  parseClaudeUsageBarHistory,
  type ExternalUsagePoint,
} from './external-history';
import { retainHistory } from './retention';
import { createEmptyHistory, type UsageHistory } from './usage-history';

const NOW = 1_800_000_000_000;

function external(ageMs: number, fiveHour: number | null, sevenDay: number | null = null): ExternalUsagePoint {
  return { at: NOW - ageMs, fiveHour, sevenDay };
}

describe('parseClaudeUsageBarHistory', () => {
  it('converte fração em percentual e o timestamp ISO em epoch ms', () => {
    const parsed = parseClaudeUsageBarHistory({
      dataPoints: [{ id: 'a', pct5h: 0.05, pct7d: 0.72, timestamp: '2026-10-06T17:12:03Z' }],
    });
    expect(parsed).toEqual([{ at: Date.parse('2026-10-06T17:12:03Z'), fiveHour: 5, sevenDay: 72 }]);
  });

  it('arredonda o ruído de ponto flutuante', () => {
    const [point] = parseClaudeUsageBarHistory({ dataPoints: [{ pct5h: 0.07, pct7d: 0.29, timestamp: '2026-10-06T17:12:03Z' }] });
    expect(point).toMatchObject({ fiveHour: 7, sevenDay: 29 });
  });

  it('é tolerante: lixo vira lista vazia e entradas inválidas são descartadas', () => {
    expect(parseClaudeUsageBarHistory(null)).toEqual([]);
    expect(parseClaudeUsageBarHistory('x')).toEqual([]);
    expect(parseClaudeUsageBarHistory({})).toEqual([]);
    expect(parseClaudeUsageBarHistory({ dataPoints: 'x' })).toEqual([]);
    const parsed = parseClaudeUsageBarHistory({
      dataPoints: [
        null,
        'x',
        { pct5h: 0.1, timestamp: 'ontem' },
        { pct5h: 0.1 },
        { timestamp: '2026-10-06T17:00:00Z' },
        { pct5h: 'a', pct7d: -1, timestamp: '2026-10-06T17:00:00Z' },
        { pct5h: 9, pct7d: 0.2, timestamp: '2026-10-06T17:01:00Z' },
        { pct5h: 0.3, timestamp: '2026-10-06T17:02:00Z' },
      ],
    });
    expect(parsed).toEqual([
      { at: Date.parse('2026-10-06T17:01:00Z'), fiveHour: null, sevenDay: 20 },
      { at: Date.parse('2026-10-06T17:02:00Z'), fiveHour: 30, sevenDay: null },
    ]);
  });

  it('ordena por timestamp e aceita epoch em segundos ou ms', () => {
    const parsed = parseClaudeUsageBarHistory({
      dataPoints: [
        { pct5h: 0.2, timestamp: 1_800_000_100_000 },
        { pct5h: 0.1, timestamp: 1_800_000_000 },
      ],
    });
    expect(parsed.map((point) => point.at)).toEqual([1_800_000_000_000, 1_800_000_100_000]);
  });
});

describe('mergeExternalPoints', () => {
  it('importa em cada janela só o que veio preenchido, marcando como importado e sem resetsAt', () => {
    const merged = mergeExternalPoints(createEmptyHistory(), [external(HOUR_MS, 10, null), external(2 * HOUR_MS, null, 40)], NOW);
    expect(merged.fiveHour).toEqual([{ at: NOW - HOUR_MS, utilization: 10, resetsAt: null, imported: true }]);
    expect(merged.sevenDay).toEqual([{ at: NOW - 2 * HOUR_MS, utilization: 40, resetsAt: null, imported: true }]);
  });

  it('deduplica por timestamp com tolerância de 1 minuto e mantém o ponto nosso', () => {
    const history: UsageHistory = {
      fiveHour: [{ at: NOW - HOUR_MS, utilization: 11, resetsAt: NOW + HOUR_MS }],
      sevenDay: [],
    };
    const merged = mergeExternalPoints(
      history,
      [
        external(HOUR_MS + EXTERNAL_DEDUPE_TOLERANCE_MS, 99),
        external(HOUR_MS - EXTERNAL_DEDUPE_TOLERANCE_MS, 98),
        external(HOUR_MS + EXTERNAL_DEDUPE_TOLERANCE_MS + 1, 20),
      ],
      NOW,
    );
    expect(merged.fiveHour.map((point) => [point.utilization, point.imported ?? false])).toEqual([
      [20, true],
      [11, false],
    ]);
  });

  it('pontos externos colados entre si também colapsam', () => {
    const merged = mergeExternalPoints(
      createEmptyHistory(),
      [external(HOUR_MS, 10), external(HOUR_MS - 20_000, 11), external(HOUR_MS - 5 * MINUTE_MS, 12)],
      NOW,
    );
    expect(merged.fiveHour.map((point) => point.utilization)).toEqual([10, 12]);
  });

  it('descarta o que é anterior a 30 dias e o que está no futuro', () => {
    const merged = mergeExternalPoints(
      createEmptyHistory(),
      [external(31 * DAY_MS, 90), external(29 * DAY_MS, 10), external(-10 * MINUTE_MS, 50)],
      NOW,
    );
    expect(merged.fiveHour.map((point) => point.utilization)).toEqual([10]);
  });

  it('é idempotente e a retenção agrega os antigos em baldes de 15 min pelo máximo', () => {
    const points = [external(10 * DAY_MS, 20), external(10 * DAY_MS - 3 * MINUTE_MS, 35), external(DAY_MS, 5)];
    const once = retainHistory(mergeExternalPoints(createEmptyHistory(), points, NOW), NOW);
    const twice = retainHistory(mergeExternalPoints(once, points, NOW), NOW);
    expect(twice).toEqual(once);
    expect(once.fiveHour).toHaveLength(2);
    expect(once.fiveHour[0]).toMatchObject({ utilization: 35, imported: true });
    expect(once.fiveHour[1]).toMatchObject({ at: NOW - DAY_MS, utilization: 5 });
  });

  it('não muta o histórico recebido', () => {
    const history = createEmptyHistory();
    mergeExternalPoints(history, [external(HOUR_MS, 10)], NOW);
    expect(history.fiveHour).toEqual([]);
  });
});
