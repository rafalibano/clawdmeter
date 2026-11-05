import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../../domain/settings';
import { PageRegistry } from '../pages/page-registry';
import { FakeClock, flushPromises } from '../testing/fake-clock';
import { fakePage } from '../testing/fake-page';
import { PollingScheduler } from './polling-scheduler';

describe('PollingScheduler.refresh', () => {
  it('reloads the page right away, without waiting for the interval', async () => {
    const load = vi.fn(async () => 'dados');
    const scheduler = new PollingScheduler(
      new PageRegistry([fakePage({ id: 'usage', pollIntervalMs: 60_000, load })]),
      new FakeClock(),
    );
    scheduler.sync(createDefaultSettings());
    await flushPromises();
    await scheduler.refresh('usage');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ignores disabled or unknown pages', async () => {
    const load = vi.fn(async () => 'dados');
    const scheduler = new PollingScheduler(new PageRegistry([fakePage({ id: 'usage', load })]), new FakeClock());
    scheduler.sync({ ...createDefaultSettings(), enabledPages: { usage: false } });
    await scheduler.refresh('usage');
    await scheduler.refresh('nada');
    expect(load).not.toHaveBeenCalled();
  });
});
