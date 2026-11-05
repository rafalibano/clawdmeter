import { describe, expect, it } from 'vitest';
import { DAY_MS, MINUTE_MS } from '../time';
import { AGGREGATE_BUCKET_MS, retainHistory, retainPoints } from './retention';
import { createEmptyHistory, type UsagePoint } from './usage-history';

const NOW = 1_800_000_000_000;

function point(ageMs: number, utilization: number): UsagePoint {
  return { at: NOW - ageMs, utilization, resetsAt: null };
}

describe('retainPoints', () => {
  it('mantém pontos brutos dos últimos 7 dias', () => {
    const points = [point(6 * DAY_MS, 10), point(DAY_MS, 20), point(0, 30)];
    expect(retainPoints(points, NOW)).toEqual(points);
  });

  it('descarta o que passou de 30 dias', () => {
    const points = [point(31 * DAY_MS, 90), point(29 * DAY_MS, 10)];
    expect(retainPoints(points, NOW).map((p) => p.utilization)).toEqual([10]);
  });

  it('agrega do 8º ao 30º dia em baldes de 15 min pelo máximo', () => {
    const base = NOW - 10 * DAY_MS;
    const bucket = Math.floor(base / AGGREGATE_BUCKET_MS) * AGGREGATE_BUCKET_MS;
    const points = [
      { at: bucket + MINUTE_MS, utilization: 20, resetsAt: null },
      { at: bucket + 5 * MINUTE_MS, utilization: 55, resetsAt: 9 },
      { at: bucket + 9 * MINUTE_MS, utilization: 35, resetsAt: null },
      { at: bucket + AGGREGATE_BUCKET_MS + MINUTE_MS, utilization: 5, resetsAt: null },
    ];
    expect(retainPoints(points, NOW)).toEqual([
      { at: bucket, utilization: 55, resetsAt: 9 },
      { at: bucket + AGGREGATE_BUCKET_MS, utilization: 5, resetsAt: null },
    ]);
  });

  it('é idempotente e mantém a ordem cronológica', () => {
    const points = [point(20 * DAY_MS, 30), point(20 * DAY_MS - MINUTE_MS, 40), point(8 * DAY_MS, 10), point(3 * DAY_MS, 50), point(0, 60)];
    const once = retainPoints(points, NOW);
    expect(retainPoints(once, NOW)).toEqual(once);
    expect(once.map((p) => p.at)).toEqual([...once.map((p) => p.at)].sort((a, b) => a - b));
  });

  it('ponto bruto que envelhece além de 7 dias entra no balde já agregado', () => {
    const first = retainPoints([point(7 * DAY_MS + MINUTE_MS, 40)], NOW);
    const later = retainPoints([...first, { at: first[0]!.at + MINUTE_MS, utilization: 70, resetsAt: null }], NOW);
    expect(later).toHaveLength(1);
    expect(later[0]!.utilization).toBe(70);
  });

  it('o balde agregado preserva a marca de importado do ponto máximo', () => {
    const bucket = Math.floor((NOW - 10 * DAY_MS) / AGGREGATE_BUCKET_MS) * AGGREGATE_BUCKET_MS;
    const retained = retainPoints(
      [
        { at: bucket + MINUTE_MS, utilization: 20, resetsAt: 9 },
        { at: bucket + 2 * MINUTE_MS, utilization: 40, resetsAt: null, imported: true },
      ],
      NOW,
    );
    expect(retained).toEqual([{ at: bucket, utilization: 40, resetsAt: null, imported: true }]);
  });

  it('histórico vazio continua vazio', () => {
    expect(retainHistory(createEmptyHistory(), NOW)).toEqual(createEmptyHistory());
  });

  it('retém as duas janelas', () => {
    const history = { fiveHour: [point(40 * DAY_MS, 1), point(0, 2)], sevenDay: [point(0, 3)] };
    const retained = retainHistory(history, NOW);
    expect(retained.fiveHour).toHaveLength(1);
    expect(retained.sevenDay).toHaveLength(1);
  });
});