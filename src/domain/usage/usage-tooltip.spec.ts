import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from '../time';
import { USAGE_UNAVAILABLE_TOOLTIP, describeUsageTooltip } from './usage-tooltip';

const NOW = Date.UTC(2026, 10, 5, 12, 0);
const UTC = 'UTC';

describe('describeUsageTooltip', () => {
  it('mostra percentual e reset de cada janela, com o dia da semana quando não é hoje', () => {
    const tooltip = describeUsageTooltip(
      {
        fiveHour: { utilization: 24.2, resetsAt: Date.UTC(2026, 10, 5, 14, 9) },
        sevenDay: { utilization: 50.6, resetsAt: Date.UTC(2026, 10, 9, 5, 39) },
      },
      NOW,
      UTC,
    );
    expect(tooltip).toBe('5h: 24% · reseta 14:09 | 7d: 51% · reseta seg 05:39');
  });

  it('janela sem leitura vira "sem dado" e reset desconhecido some', () => {
    expect(
      describeUsageTooltip({ fiveHour: { utilization: 3, resetsAt: null }, sevenDay: null }, NOW, UTC),
    ).toBe('5h: 3% | 7d: sem dado');
  });

  it('usa o fuso informado para decidir se o reset é hoje', () => {
    const evening = NOW + 8 * HOUR_MS;
    const snapshot = { fiveHour: { utilization: 10, resetsAt: evening + 5 * HOUR_MS }, sevenDay: null };
    expect(describeUsageTooltip(snapshot, evening, UTC)).toContain('reseta sex 01:00');
    expect(describeUsageTooltip(snapshot, evening, 'America/Sao_Paulo')).toContain('reseta 22:00');
  });

  it('um dia depois do reset ainda cita o dia da semana', () => {
    const snapshot = { fiveHour: { utilization: 10, resetsAt: NOW + DAY_MS }, sevenDay: null };
    expect(describeUsageTooltip(snapshot, NOW, UTC)).toContain('reseta sex 12:00');
  });

  it('sem snapshot (erro ou desconectado) avisa que o usage está indisponível', () => {
    expect(describeUsageTooltip(null, NOW, UTC)).toBe(USAGE_UNAVAILABLE_TOOLTIP);
  });
});
