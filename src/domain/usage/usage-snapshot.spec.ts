import { describe, expect, it } from 'vitest';
import { parseUsageResponse } from './usage-snapshot';

describe('parseUsageResponse', () => {
  it('lê five_hour e seven_day com resets_at ISO', () => {
    const snapshot = parseUsageResponse({
      five_hour: { utilization: 37.5, resets_at: '2026-11-05T17:00:00.123456+00:00' },
      seven_day: { utilization: 12, resets_at: '2026-11-09T10:00:00+00:00' },
    });
    expect(snapshot.fiveHour).toEqual({ utilization: 37.5, resetsAt: Date.parse('2026-11-05T17:00:00.123+00:00') });
    expect(snapshot.sevenDay?.utilization).toBe(12);
  });

  it('ignora campos extras e janelas desconhecidas', () => {
    const snapshot = parseUsageResponse({
      five_hour: { utilization: 1, resets_at: null, extra: true },
      seven_day_opus: { utilization: 9, resets_at: null },
      extra_usage: { is_enabled: false },
    });
    expect(snapshot).toEqual({ fiveHour: { utilization: 1, resetsAt: null }, sevenDay: null });
  });

  it('aceita utilização textual e resets_at em epoch (s ou ms)', () => {
    const snapshot = parseUsageResponse({
      five_hour: { utilization: '42', resets_at: 1_800_000_000 },
      seven_day: { utilization: 5, resets_at: 1_800_000_000_000 },
    });
    expect(snapshot.fiveHour).toEqual({ utilization: 42, resetsAt: 1_800_000_000_000 });
    expect(snapshot.sevenDay?.resetsAt).toBe(1_800_000_000_000);
  });

  it('janela sem utilização válida vira null; resets_at inválido vira null', () => {
    const snapshot = parseUsageResponse({
      five_hour: { utilization: 'x', resets_at: 'amanhã' },
      seven_day: { utilization: -3, resets_at: 'amanhã' },
    });
    expect(snapshot.fiveHour).toBeNull();
    expect(snapshot.sevenDay).toEqual({ utilization: 0, resetsAt: null });
  });

  it('resposta irreconhecível levanta erro', () => {
    expect(() => parseUsageResponse({})).toThrow('sem five_hour nem seven_day');
    expect(() => parseUsageResponse(null)).toThrow();
    expect(() => parseUsageResponse('texto')).toThrow();
  });
});
