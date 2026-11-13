import { describe, expect, it } from 'vitest';
import { createDefaultSettings, type AppSettings } from '../../domain/settings';
import type { RawDailyUsage } from '../../domain/usage';
import type { DailyUsageReader } from '../ports';
import { FakeClock, flushPromises } from '../testing/fake-clock';
import { LoadDailyUsage } from '../use-cases/usage/load-daily-usage';
import { DAILY_USAGE_POLL_MS, DailyUsageHistory, type DailyUsageState } from './daily-usage-history';

const RAW: RawDailyUsage = {
  complete: true,
  truncated: false,
  days: [{ start: 1, models: [{ model: 'claude-opus-5-5', tokens: 10 }], sessions: 1, contextPeaks: [5] }],
};

class FakeReader implements DailyUsageReader {
  reads = 0;
  failing = false;
  gates: Array<Promise<void>> = [];

  async read(): Promise<RawDailyUsage> {
    this.reads += 1;
    const gate = this.gates.shift();
    if (gate) await gate;
    if (this.failing) throw new Error('boom');
    return RAW;
  }
}

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...createDefaultSettings(), usageDailyHistory: true, ...overrides };
}

const OFF = settings({ usageDailyHistory: false });

function gate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

function setup() {
  const clock = new FakeClock();
  const reader = new FakeReader();
  const history = new DailyUsageHistory(new LoadDailyUsage(reader, clock), clock);
  const seen: Array<DailyUsageState | null> = [];
  history.subscribe((state) => seen.push(state));
  return { clock, reader, history, seen };
}

const tokensOf = (state: DailyUsageState | null) => (state?.status === 'ready' ? state.usage.totalTokens : null);

describe('DailyUsageHistory', () => {
  it('does not read anything nor start a timer while the switch is off', async () => {
    const { clock, reader, history, seen } = setup();
    history.sync(OFF, true);
    await flushPromises();
    expect(reader.reads).toBe(0);
    expect(clock.activeTimers()).toBe(0);
    expect(history.current).toBeNull();
    expect(seen).toEqual([null]);
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

  it('shows loading at once, then the usage, and reads again on its own slow timer', async () => {
    const { clock, reader, history, seen } = setup();
    const first = gate();
    reader.gates = [first.promise];
    history.sync(settings(), true);
    expect(history.current).toEqual({ status: 'loading' });
    await flushPromises();
    expect(reader.reads).toBe(1);
    expect(tokensOf(history.current)).toBeNull();
    first.release();
    await flushPromises();
    expect(tokensOf(history.current)).toBe(10);
    expect(seen.map((state) => state?.status ?? null)).toEqual([null, 'loading', 'ready']);
    await clock.advance(DAILY_USAGE_POLL_MS - 1);
    expect(reader.reads).toBe(1);
    await clock.advance(1);
    expect(reader.reads).toBe(2);
    expect(DAILY_USAGE_POLL_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('reads right away from the in-memory settings, whatever the saved file says', async () => {
    const { reader, history } = setup();
    history.sync(settings(), true);
    await flushPromises();
    expect(reader.reads).toBe(1);
    expect(tokensOf(history.current)).toBe(10);
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
    history.sync(OFF, true);
    expect(clock.activeTimers()).toBe(0);
    expect(history.current).toBeNull();
    expect(seen.at(-1)).toBeNull();
    await clock.advance(DAILY_USAGE_POLL_MS * 3);
    expect(reader.reads).toBe(1);
  });

  it('a read that finishes after the switch went off is discarded', async () => {
    const { reader, history } = setup();
    const pending = gate();
    reader.gates = [pending.promise];
    history.sync(settings(), true);
    await flushPromises();
    history.sync(OFF, true);
    pending.release();
    await flushPromises();
    expect(history.current).toBeNull();
  });

  it('on, off and on again while the first read is pending still ends with a snapshot', async () => {
    const { reader, history } = setup();
    const slow = gate();
    reader.gates = [slow.promise];
    history.sync(settings(), true);
    await flushPromises();
    history.sync(OFF, true);
    history.sync(settings(), true);
    await flushPromises();
    expect(reader.reads).toBe(2);
    expect(tokensOf(history.current)).toBe(10);
    slow.release();
    await flushPromises();
    expect(tokensOf(history.current)).toBe(10);
  });

  it('does not overlap two reads of the same run', async () => {
    const { clock, reader, history } = setup();
    const pending = gate();
    reader.gates = [pending.promise];
    history.sync(settings(), true);
    await clock.advance(DAILY_USAGE_POLL_MS * 2);
    expect(reader.reads).toBe(1);
    pending.release();
    await flushPromises();
    expect(tokensOf(history.current)).toBe(10);
  });

  it('a failure hides the block, including the loading state, and the next poll tries again', async () => {
    const { clock, reader, history } = setup();
    reader.failing = true;
    history.sync(settings(), true);
    await flushPromises();
    expect(history.current).toBeNull();
    reader.failing = false;
    await clock.advance(DAILY_USAGE_POLL_MS);
    expect(tokensOf(history.current)).toBe(10);
    reader.failing = true;
    await clock.advance(DAILY_USAGE_POLL_MS);
    expect(history.current).toBeNull();
  });

  it('subscribers get the current value at once and can unsubscribe', async () => {
    const { history } = setup();
    const received: Array<DailyUsageState | null> = [];
    const stop = history.subscribe((state) => received.push(state));
    history.sync(settings(), true);
    await flushPromises();
    stop();
    history.stop();
    expect(received.map((state) => state?.status ?? null)).toEqual([null, 'loading', 'ready']);
  });
});
