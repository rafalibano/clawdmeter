import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from '../time';
import { describeUsageTooltip, type UsageTooltipTexts } from './usage-tooltip';

const NOW = Date.UTC(2026, 10, 5, 12, 0);
const UTC = 'UTC';
const PT: UsageTooltipTexts = {
  locale: 'pt-BR',
  unavailable: 'Dev Pulse · usage indisponível',
  noData: (label) => `${label}: sem dado`,
  resets: (when) => `reseta ${when}`,
};
const EN: UsageTooltipTexts = {
  locale: 'en-US',
  unavailable: 'Dev Pulse · usage unavailable',
  noData: (label) => `${label}: no data`,
  resets: (when) => `resets ${when}`,
};

describe('describeUsageTooltip', () => {
  it('mostra percentual e reset de cada janela, com o dia da semana quando não é hoje', () => {
    const tooltip = describeUsageTooltip(
      {
        fiveHour: { utilization: 24.2, resetsAt: Date.UTC(2026, 10, 5, 14, 9) },
        sevenDay: { utilization: 50.6, resetsAt: Date.UTC(2026, 10, 9, 5, 39) },
      },
      NOW,
      PT,
      UTC,
    );
    expect(tooltip).toBe('5h: 24% · reseta 14:09 | 7d: 51% · reseta seg 05:39');
  });

  it('janela sem leitura vira "sem dado" e reset desconhecido some', () => {
    expect(
      describeUsageTooltip({ fiveHour: { utilization: 3, resetsAt: null }, sevenDay: null }, NOW, PT, UTC),
    ).toBe('5h: 3% | 7d: sem dado');
  });

  it('usa o fuso informado para decidir se o reset é hoje', () => {
    const evening = NOW + 8 * HOUR_MS;
    const snapshot = { fiveHour: { utilization: 10, resetsAt: evening + 5 * HOUR_MS }, sevenDay: null };
    expect(describeUsageTooltip(snapshot, evening, PT, UTC)).toContain('reseta sex 01:00');
    expect(describeUsageTooltip(snapshot, evening, PT, 'America/Sao_Paulo')).toContain('reseta 22:00');
  });

  it('um dia depois do reset ainda cita o dia da semana', () => {
    const snapshot = { fiveHour: { utilization: 10, resetsAt: NOW + DAY_MS }, sevenDay: null };
    expect(describeUsageTooltip(snapshot, NOW, PT, UTC)).toContain('reseta sex 12:00');
  });

  it('sem snapshot (erro ou desconectado) avisa que o usage está indisponível', () => {
    expect(describeUsageTooltip(null, NOW, PT, UTC)).toBe('Dev Pulse · usage indisponível');
  });

  it('segue a língua: textos e dia da semana em inglês', () => {
    const snapshot = { fiveHour: { utilization: 10, resetsAt: NOW + DAY_MS }, sevenDay: null };
    expect(describeUsageTooltip(snapshot, NOW, EN, UTC)).toBe('5h: 10% · resets fri 12:00 | 7d: no data');
    expect(describeUsageTooltip(null, NOW, EN, UTC)).toBe('Dev Pulse · usage unavailable');
  });
});
