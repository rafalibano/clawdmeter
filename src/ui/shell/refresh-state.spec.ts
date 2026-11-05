import { describe, expect, it } from 'vitest';
import { REFRESH_COOLDOWN_MS, refreshState } from './refresh-state';

const NOW = 1_000_000;
const idle = { now: NOW, loading: false, cooldownUntil: 0, backoffUntil: null };

describe('refreshState', () => {
  it('livre: habilitado com o tooltip "Atualizar"', () => {
    expect(refreshState(idle)).toEqual({ disabled: false, spinning: false, tooltip: { key: 'refresh.tooltip' } });
  });

  it('carregando: desabilitado e girando', () => {
    expect(refreshState({ ...idle, loading: true })).toEqual({
      disabled: true,
      spinning: true,
      tooltip: { key: 'refresh.loading' },
    });
  });

  it('cooldown de 30 s depois do clique, com o tempo restante', () => {
    expect(REFRESH_COOLDOWN_MS).toBe(30_000);
    expect(refreshState({ ...idle, cooldownUntil: NOW + 12_000 })).toEqual({
      disabled: true,
      spinning: false,
      tooltip: { key: 'refresh.cooldown', remainingMs: 12_000 },
    });
    expect(refreshState({ ...idle, cooldownUntil: NOW })).toMatchObject({ disabled: false });
  });

  it('em backoff de rate limit mostra o tempo restante e não deixa chamar', () => {
    expect(refreshState({ ...idle, backoffUntil: NOW + 300_000 })).toEqual({
      disabled: true,
      spinning: false,
      tooltip: { key: 'refresh.rateLimited', remainingMs: 300_000 },
    });
  });

  it('o backoff vence o cooldown; backoff vencido libera', () => {
    expect(refreshState({ ...idle, cooldownUntil: NOW + 5_000, backoffUntil: NOW + 60_000 }).tooltip.key).toBe('refresh.rateLimited');
    expect(refreshState({ ...idle, backoffUntil: NOW - 1 })).toMatchObject({ disabled: false });
  });
});
