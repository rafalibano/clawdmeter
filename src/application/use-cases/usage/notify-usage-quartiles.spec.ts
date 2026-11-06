import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../../domain/settings';
import type { UsageSnapshot } from '../../../domain/usage';
import { createConnections, type Connections } from '../../connections/create-connections';
import { FakeClock } from '../../testing/fake-clock';
import { createFakeConnectionWorld, type FakeConnectionWorld } from '../../testing/fake-connection-adapters';
import { FakeNotifier } from '../../testing/fake-feature-adapters';
import { FakeSettingsStore } from '../../testing/fake-settings-store';
import { FakeTranslator } from '../../testing/fake-translator';
import { NotifyUsageQuartiles } from './notify-usage-quartiles';

const START = new Date(2027, 0, 15, 12).getTime();

const snapshot = (fiveHour: number | null, sevenDay: number | null, resetsAt: number | null = START + 3_600_000): UsageSnapshot => ({
  fiveHour: fiveHour === null ? null : { utilization: fiveHour, resetsAt },
  sevenDay: sevenDay === null ? null : { utilization: sevenDay, resetsAt },
});

let world: FakeConnectionWorld;
let connections: Connections;
let notifier: FakeNotifier;
let settings: FakeSettingsStore;
let notify: NotifyUsageQuartiles;

function setAlerts(fiveHour: (25 | 50 | 75 | 100)[], sevenDay: (25 | 50 | 75 | 100)[]): void {
  settings.emitExternalChange({ ...createDefaultSettings(), usageAlerts: { fiveHour, sevenDay } });
}

beforeEach(async () => {
  world = createFakeConnectionWorld();
  const clock = new FakeClock();
  await clock.advance(START);
  connections = createConnections(world.adapters, clock);
  await connections.check.execute('notifications');
  notifier = new FakeNotifier();
  settings = new FakeSettingsStore();
  notify = new NotifyUsageQuartiles(notifier, connections, new FakeTranslator(), settings, clock);
});

describe('NotifyUsageQuartiles', () => {
  it('does not notify on the first reading, even above a selected quartile', async () => {
    await notify.execute(snapshot(80, 80));
    expect(notifier.sent).toEqual([]);
  });

  it('notifies once when the default 50% is crossed and not again in the same cycle', async () => {
    await notify.execute(snapshot(10, 10));
    await notify.execute(snapshot(55, 10));
    await notify.execute(snapshot(60, 10));
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].title).toBe('5h usage at 55%');
  });

  it('the body says when the window resets, and a simple text without resetsAt', async () => {
    await notify.execute(snapshot(10, null));
    await notify.execute(snapshot(55, null));
    expect(notifier.sent[0].body).toMatch(/^Resets \d{2}:\d{2}$/);
    await notify.execute(snapshot(10, 10, null));
    await notify.execute(snapshot(5, 10, null));
    await notify.execute(snapshot(60, 10, null));
    expect(notifier.sent.at(-1)?.body).toBe('Check your usage in ClawdMeter.');
  });

  it('the body includes the weekday when the window resets on another local day', async () => {
    const nextDay = new Date(2027, 0, 16, 9).getTime();
    await notify.execute(snapshot(10, null, nextDay));
    await notify.execute(snapshot(55, null, nextDay));
    expect(notifier.sent[0].body).toMatch(/^Resets \S+ 09:00$/);
  });

  it('respects the list of each window', async () => {
    setAlerts([], [25, 75]);
    await notify.execute(snapshot(10, 10));
    await notify.execute(snapshot(60, 80));
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['7d usage at 80%']);
  });

  it('one notification per window when both cross in the same reading', async () => {
    await notify.execute(snapshot(10, 10));
    await notify.execute(snapshot(60, 60));
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['5h usage at 60%', '7d usage at 60%']);
  });

  it('does not notify when the notifications connection is not connected', async () => {
    world.notifications.state = 'denied';
    await connections.check.execute('notifications');
    await notify.execute(snapshot(10, 10));
    await notify.execute(snapshot(60, 60));
    expect(notifier.sent).toEqual([]);
  });

  it('swallows a notifier failure', async () => {
    notifier.fail = true;
    await notify.execute(snapshot(10, 10));
    await expect(notify.execute(snapshot(60, 60))).resolves.toBeUndefined();
  });

  it('a failing notification does not prevent the other window from being notified', async () => {
    const delivered: string[] = [];
    let calls = 0;
    notifier.notify = async (notice) => {
      if (calls++ === 0) throw new Error('notification rejected');
      delivered.push(notice.title);
    };
    await notify.execute(snapshot(10, 10));
    await notify.execute(snapshot(60, 60));
    expect(calls).toBe(2);
    expect(delivered).toEqual(['7d usage at 60%']);
  });

  it('evaluates concurrent executions in the order they were called', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = settings.load.bind(settings);
    let loads = 0;
    settings.load = async () => {
      if (loads++ === 0) await gate;
      return load();
    };
    const first = notify.execute(snapshot(10, 10));
    const second = notify.execute(snapshot(60, 60));
    release();
    await Promise.all([first, second]);
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['5h usage at 60%', '7d usage at 60%']);
  });

  it('the title never shows a quartile that was not crossed', async () => {
    setAlerts([50, 100], []);
    await notify.execute(snapshot(10, 10));
    await notify.execute(snapshot(75.6, 10));
    await notify.execute(snapshot(120, 10));
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['5h usage at 75%', '5h usage at 120%']);
  });

  it('swallows a failure reading the settings', async () => {
    settings.load = async () => {
      throw new Error('unreadable');
    };
    await expect(notify.execute(snapshot(60, 60))).resolves.toBeUndefined();
    expect(notifier.sent).toEqual([]);
  });

  it('ignores a window missing from the snapshot', async () => {
    await notify.execute(snapshot(null, 10));
    await notify.execute(snapshot(null, 60));
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['7d usage at 60%']);
  });

  it('notifies again after the cycle restarts', async () => {
    await notify.execute(snapshot(10, 10));
    await notify.execute(snapshot(60, 10));
    await notify.execute(snapshot(5, 10, START + 6 * 3_600_000));
    await notify.execute(snapshot(60, 10, START + 6 * 3_600_000));
    expect(notifier.sent).toHaveLength(2);
  });
});
