import { describe, expect, it } from 'vitest';
import { REFRESH_COOLDOWN_MS, refreshState } from './refresh-state';

const NOW = 1_000_000;
const idle = { now: NOW, loading: false, cooldownUntil: 0, backoffUntil: null };

describe('refreshState', () => {
  it('idle: enabled with the "Refresh" tooltip', () => {
    expect(refreshState(idle)).toEqual({ disabled: false, spinning: false, tooltip: { key: 'refresh.tooltip' } });
  });

  it('loading: disabled and spinning', () => {
    expect(refreshState({ ...idle, loading: true })).toEqual({
      disabled: true,
      spinning: true,
      tooltip: { key: 'refresh.loading' },
    });
  });

  it('30 s cooldown after the click, with the remaining time', () => {
    expect(REFRESH_COOLDOWN_MS).toBe(30_000);
    expect(refreshState({ ...idle, cooldownUntil: NOW + 12_000 })).toEqual({
      disabled: true,
      spinning: false,
      tooltip: { key: 'refresh.cooldown', remainingMs: 12_000 },
    });
    expect(refreshState({ ...idle, cooldownUntil: NOW })).toMatchObject({ disabled: false });
  });

  it('in rate limit backoff shows the remaining time and blocks the call', () => {
    expect(refreshState({ ...idle, backoffUntil: NOW + 300_000 })).toEqual({
      disabled: true,
      spinning: false,
      tooltip: { key: 'refresh.rateLimited', remainingMs: 300_000 },
    });
  });

  it('backoff wins over cooldown; expired backoff releases', () => {
    expect(refreshState({ ...idle, cooldownUntil: NOW + 5_000, backoffUntil: NOW + 60_000 }).tooltip.key).toBe('refresh.rateLimited');
    expect(refreshState({ ...idle, backoffUntil: NOW - 1 })).toMatchObject({ disabled: false });
  });
});
