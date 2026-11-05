import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitedError, rateLimitDelay } from '../../domain/rate-limit';
import { createDefaultSettings } from '../../domain/settings';
import { MINUTE_MS } from '../../domain/time';
import { PageRegistry } from '../pages/page-registry';
import { FakeClock, flushPromises } from '../testing/fake-clock';
import { fakePage } from '../testing/fake-page';
import { PollingScheduler, type PageUpdate } from './polling-scheduler';

describe('rateLimitDelay', () => {
  it('sobe 5 -> 10 -> 20 -> 30 min e para em 30', () => {
    expect([1, 2, 3, 4, 5, 9].map((failures) => rateLimitDelay(failures, null) / MINUTE_MS)).toEqual([5, 10, 20, 30, 30, 30]);
  });

  it('o Retry-After maior vence o backoff e o menor não encurta', () => {
    expect(rateLimitDelay(1, 12 * MINUTE_MS)).toBe(12 * MINUTE_MS);
    expect(rateLimitDelay(2, MINUTE_MS)).toBe(10 * MINUTE_MS);
  });
});

describe('PollingScheduler com rate limit', () => {
  let clock: FakeClock;
  let updates: PageUpdate[];
  let outcome: () => Promise<string>;
  let load: ReturnType<typeof vi.fn>;
  let scheduler: PollingScheduler;

  beforeEach(() => {
    clock = new FakeClock();
    updates = [];
    outcome = async () => 'ok';
    load = vi.fn(() => outcome());
    const registry = new PageRegistry([fakePage({ id: 'usage', pollIntervalMs: 5 * MINUTE_MS, load: load as () => Promise<string> })]);
    scheduler = new PollingScheduler(registry, clock);
    scheduler.subscribe((update) => updates.push(update));
  });

  const limited = (retryAfterMs: number | null = null) => () => Promise.reject(new RateLimitedError(retryAfterMs));

  it('429 publica o erro com o horário da próxima tentativa e adia o poll', async () => {
    outcome = limited();
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    expect(updates[0]).toMatchObject({ status: 'error', rateLimitedUntil: 5 * MINUTE_MS });
    expect(scheduler.backoffUntil('usage')).toBe(5 * MINUTE_MS);
    await clock.advance(4 * MINUTE_MS);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('o backoff dobra a cada falha seguida: 5, 10, 20, 30, 30 min', async () => {
    outcome = limited();
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    const waits: number[] = [];
    for (let index = 0; index < 4; index++) {
      const before = clock.now();
      const until = scheduler.backoffUntil('usage')!;
      await clock.advance(until - before);
      await clock.advance(5 * MINUTE_MS);
      const next = scheduler.backoffUntil('usage');
      waits.push(((next ?? 0) - until) / MINUTE_MS);
    }
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(waits.slice(0, 3)).toEqual([10, 20, 30]);
  });

  it('o Retry-After maior que o backoff é respeitado', async () => {
    outcome = limited(12 * MINUTE_MS);
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    expect(scheduler.backoffUntil('usage')).toBe(12 * MINUTE_MS);
    await clock.advance(11 * MINUTE_MS);
    expect(load).toHaveBeenCalledTimes(1);
    await clock.advance(5 * MINUTE_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('refresh manual em backoff não chama a fonte', async () => {
    outcome = limited();
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    await scheduler.refresh('usage');
    await scheduler.refresh('usage');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('um sucesso zera o backoff e volta ao ritmo normal', async () => {
    outcome = limited();
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    outcome = async () => 'ok';
    await clock.advance(5 * MINUTE_MS);
    expect(updates[updates.length - 1]).toMatchObject({ status: 'ok' });
    expect(scheduler.backoffUntil('usage')).toBeNull();
    const calls = load.mock.calls.length;
    await clock.advance(5 * MINUTE_MS);
    expect(load.mock.calls.length).toBe(calls + 1);
    outcome = limited();
    await clock.advance(5 * MINUTE_MS);
    expect(scheduler.backoffUntil('usage')! - clock.now()).toBe(5 * MINUTE_MS);
  });

  it('erro comum não aciona backoff', async () => {
    outcome = () => Promise.reject(new Error('rede'));
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    expect(updates[0]).toMatchObject({ status: 'error' });
    expect(updates[0]).not.toHaveProperty('rateLimitedUntil');
    expect(scheduler.backoffUntil('usage')).toBeNull();
    await clock.advance(5 * MINUTE_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
