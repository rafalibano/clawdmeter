import { describe, expect, it } from 'vitest';
import { createDefaultSettings, type AppSettings } from '../../domain/settings';
import type { RawDailyUsage } from '../../domain/usage';
import type { DailyUsage } from '../../domain/usage';
import type { DailyUsageReader } from '../ports';
import { FakeClock, flushPromises } from '../testing/fake-clock';
import { FakeSettingsStore } from '../testing/fake-settings-store';
import { LoadDailyUsage } from '../use-cases/usage/load-daily-usage';
import { DAILY_USAGE_POLL_MS, DailyUsageHistory } from './daily-usage-history';

const RAW: RawDailyUsage = {
  complete: true,
  days: [{ start: 1, models: [{ model: 'claude-opus-5-5', tokens: 10 }], sessions: 1, contextPeaks: [5] }],
};

class FakeReader implements DailyUsageReader {
  reads = 0;
  failing = false;
  gate: Promise<void> | null = null;

  async read(): Promise<RawDailyUsage> {
    this.reads += 1;
    if (this.gate) await this.gate;
    if (this.failing) throw new Error('boom');
    return RAW;
  }
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...createDefaultSettings(), usageDailyHistory: true, ...overrides };
}

function setup(initial: AppSettings = settings()) {
  const clock = new FakeClock();
  const reader = new FakeReader();
  const store = new FakeSettingsStore(initial);
  const history = new DailyUsageHistory(new LoadDailyUsage(store, reader, clock), clock);
  const seen: Array<DailyUsage | null> = [];
  history.subscribe((usage) => seen.push(usage));
  return { clock, reader, store, history, seen };
}

describe('DailyUsageHistory', () => {
  it('does not read anything nor start a timer while the switch is off', async () => {
    const { clock, reader, history } = setup(settings({ usageDailyHistory: false }));
    history.sync(settings({ usageDailyHistory: false }), true);
    await flushPromises();
    expect(reader.reads).toBe(0);
    expect(clock.activeTimers()).toBe(0);
    expect(history.current).toBeNull();
  });

  it('does not read anything while the Usage page is disabled', async () => {
    const { clock, reader, history } = setup();
    history.sync(settings(), false);
    await flushPromises();
    expect(reader.reads).toBe(0);
    expect(clock.activeTimers()).toBe(0);
  });

  it('does nothing without a use case', async () => {
    const clock = new FakeClock();
    const history = new DailyUsageHistory(undefined, clock);
    history.sync(settings(), true);
    await flushPromises();
    expect(clock.activeTimers()).toBe(0);
    expect(history.current).toBeNull();
  });

  it('reads right away when switched on and then on its own slow timer', async () => {
    const { clock, reader, history } = setup();
    history.sync(settings(), true);
    await flushPromises();
    expect(reader.reads).toBe(1);
    expect(history.current?.totalTokens).toBe(10);
    await clock.advance(DAILY_USAGE_POLL_MS - 1);
    expect(reader.reads).toBe(1);
    await clock.advance(1);
    expect(reader.reads).toBe(2);
    expect(DAILY_USAGE_POLL_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('syncing again with the same settings does not read again', async () => {
    const { clock, reader, history } = setup();
    history.sync(settings(), true);
    history.sync(settings(), true);
    await flushPromises();
    expect(reader.reads).toBe(1);
    expect(clock.activeTimers()).toBe(1);
  });

  it('switching off stops the timer, hides the block and stops reading', async () => {
    const { clock, reader, history, seen } = setup();
    history.sync(settings(), true);
    await flushPromises();
    history.sync(settings({ usageDailyHistory: false }), true);
    expect(clock.activeTimers()).toBe(0);
    expect(history.current).toBeNull();
    expect(seen.at(-1)).toBeNull();
    await clock.advance(DAILY_USAGE_POLL_MS * 3);
    expect(reader.reads).toBe(1);
  });

  it('a read that finishes after the switch went off is discarded', async () => {
    const { reader, history } = setup();
    let release: () => void = () => undefined;
    reader.gate = new Promise((resolve) => (release = resolve));
    history.sync(settings(), true);
    await flushPromises();
    history.sync(settings({ usageDailyHistory: false }), true);
    release();
    await flushPromises();
    expect(history.current).toBeNull();
  });

  it('does not overlap two reads', async () => {
    const { clock, reader, history } = setup();
    let release: () => void = () => undefined;
    reader.gate = new Promise((resolve) => (release = resolve));
    history.sync(settings(), true);
    await clock.advance(DAILY_USAGE_POLL_MS * 2);
    expect(reader.reads).toBe(1);
    release();
    await flushPromises();
    expect(history.current).not.toBeNull();
  });

  it('a failure hides the block and the next poll tries again', async () => {
    const { clock, reader, history } = setup();
    history.sync(settings(), true);
    await flushPromises();
    expect(history.current).not.toBeNull();
    reader.failing = true;
    await clock.advance(DAILY_USAGE_POLL_MS);
    expect(history.current).toBeNull();
    reader.failing = false;
    await clock.advance(DAILY_USAGE_POLL_MS);
    expect(history.current?.totalTokens).toBe(10);
  });

  it('the use case itself refuses to scan when the saved switch is off, even if the timer was running', async () => {
    const { clock, reader, store, history } = setup();
    history.sync(settings(), true);
    await flushPromises();
    await store.save(settings({ usageDailyHistory: false }));
    await clock.advance(DAILY_USAGE_POLL_MS);
    expect(reader.reads).toBe(1);
    expect(history.current).toBeNull();
  });

  it('subscribers get the current value at once and can unsubscribe', async () => {
    const { history } = setup();
    const received: Array<DailyUsage | null> = [];
    const stop = history.subscribe((usage) => received.push(usage));
    history.sync(settings(), true);
    await flushPromises();
    stop();
    history.stop();
    expect(received.map((usage) => usage?.totalTokens ?? null)).toEqual([null, 10]);
  });
});
