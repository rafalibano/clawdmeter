import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSettings } from '../../../domain/settings';
import type { UsageSnapshot } from '../../../domain/usage';
import { createConnections, type Connections } from '../../connections/create-connections';
import { FakeClock } from '../../testing/fake-clock';
import {
  FAKE_ACCOUNT,
  createFakeConnectionWorld,
  settingsWithAccounts,
  type FakeConnectionWorld,
} from '../../testing/fake-connection-adapters';
import { FakeNotifier } from '../../testing/fake-feature-adapters';
import { FakeSettingsStore } from '../../testing/fake-settings-store';
import { FakeTranslator } from '../../testing/fake-translator';
import { NotifyUsageQuartiles } from './notify-usage-quartiles';

const START = new Date(2027, 0, 15, 12).getTime();
const ACCOUNT = FAKE_ACCOUNT.id;
const WORK = { id: 'account-2', name: 'Work' };

const snapshot = (fiveHour: number | null, sevenDay: number | null, resetsAt: number | null = START + 3_600_000): UsageSnapshot => ({
  fiveHour: fiveHour === null ? null : { utilization: fiveHour, resetsAt },
  sevenDay: sevenDay === null ? null : { utilization: sevenDay, resetsAt },
});

let world: FakeConnectionWorld;
let connections: Connections;
let notifier: FakeNotifier;
let settings: FakeSettingsStore;
let notify: NotifyUsageQuartiles;

function withAccounts(activeAccountId: string): AppSettings {
  return settingsWithAccounts([FAKE_ACCOUNT, WORK], activeAccountId);
}

function setAlerts(fiveHour: (25 | 50 | 75 | 100)[], sevenDay: (25 | 50 | 75 | 100)[]): void {
  settings.emitExternalChange({ ...withAccounts(ACCOUNT), usageAlerts: { fiveHour, sevenDay } });
}

function activate(accountId: string): void {
  settings.emitExternalChange(withAccounts(accountId));
}

beforeEach(async () => {
  world = createFakeConnectionWorld();
  const clock = new FakeClock();
  await clock.advance(START);
  connections = createConnections(world.adapters, world.settings);
  await connections.check.execute('notifications');
  notifier = new FakeNotifier();
  settings = new FakeSettingsStore(withAccounts(ACCOUNT));
  notify = new NotifyUsageQuartiles(notifier, connections, new FakeTranslator(), settings, clock);
});

describe('NotifyUsageQuartiles', () => {
  it('does not notify on the first reading, even above a selected quartile', async () => {
    await notify.execute(ACCOUNT, snapshot(80, 80));
    expect(notifier.sent).toEqual([]);
  });

  it('notifies once when the default 50% is crossed and not again in the same cycle', async () => {
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(55, 10));
    await notify.execute(ACCOUNT, snapshot(60, 10));
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].title).toBe('5h usage at 55%');
  });

  it('the body says when the window resets, and a simple text without resetsAt', async () => {
    await notify.execute(ACCOUNT, snapshot(10, null));
    await notify.execute(ACCOUNT, snapshot(55, null));
    expect(notifier.sent[0].body).toMatch(/^Resets \d{2}:\d{2}$/);
    await notify.execute(ACCOUNT, snapshot(10, 10, null));
    await notify.execute(ACCOUNT, snapshot(5, 10, null));
    await notify.execute(ACCOUNT, snapshot(60, 10, null));
    expect(notifier.sent.at(-1)?.body).toBe('Check your usage in ClawdMeter.');
  });

  it('the body includes the weekday when the window resets on another local day', async () => {
    const nextDay = new Date(2027, 0, 16, 9).getTime();
    await notify.execute(ACCOUNT, snapshot(10, null, nextDay));
    await notify.execute(ACCOUNT, snapshot(55, null, nextDay));
    expect(notifier.sent[0].body).toMatch(/^Resets \S+ 09:00$/);
  });

  it('respects the list of each window', async () => {
    setAlerts([], [25, 75]);
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(60, 80));
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['7d usage at 80%']);
  });

  it('one notification per window when both cross in the same reading', async () => {
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(60, 60));
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['5h usage at 60%', '7d usage at 60%']);
  });

  it('does not notify when the notifications connection is not connected', async () => {
    world.notifications.state = 'denied';
    await connections.check.execute('notifications');
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(60, 60));
    expect(notifier.sent).toEqual([]);
  });

  it('asks the OS for the permission when a quartile is due and it was never requested, then notifies', async () => {
    setAlerts([], [75]);
    world.notifications.state = 'prompt';
    await connections.check.execute('notifications');
    await notify.execute(ACCOUNT, snapshot(10, 70));
    await notify.execute(ACCOUNT, snapshot(10, 76));
    expect(world.notifications.state).toBe('granted');
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['7d usage at 76%']);
  });

  it('does not ask for the permission while no quartile is due', async () => {
    world.notifications.state = 'prompt';
    world.notifications.requestResult = 'denied';
    await connections.check.execute('notifications');
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(20, 20));
    expect(world.notifications.state).toBe('prompt');
  });

  it('a declined OS prompt sends nothing', async () => {
    world.notifications.state = 'prompt';
    world.notifications.requestResult = 'denied';
    await connections.check.execute('notifications');
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(60, 60));
    expect(notifier.sent).toEqual([]);
  });

  it('swallows a notifier failure', async () => {
    notifier.fail = true;
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await expect(notify.execute(ACCOUNT, snapshot(60, 60))).resolves.toBeUndefined();
  });

  it('a failing notification does not prevent the other window from being notified', async () => {
    const delivered: string[] = [];
    let calls = 0;
    notifier.notify = async (notice) => {
      if (calls++ === 0) throw new Error('notification rejected');
      delivered.push(notice.title);
    };
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(60, 60));
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
    const first = notify.execute(ACCOUNT, snapshot(10, 10));
    const second = notify.execute(ACCOUNT, snapshot(60, 60));
    release();
    await Promise.all([first, second]);
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['5h usage at 60%', '7d usage at 60%']);
  });

  it('the title never shows a quartile that was not crossed', async () => {
    setAlerts([50, 100], []);
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(75.6, 10));
    await notify.execute(ACCOUNT, snapshot(120, 10));
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['5h usage at 75%', '5h usage at 120%']);
  });

  it('swallows a failure reading the settings', async () => {
    settings.load = async () => {
      throw new Error('unreadable');
    };
    await expect(notify.execute(ACCOUNT, snapshot(60, 60))).resolves.toBeUndefined();
    expect(notifier.sent).toEqual([]);
  });

  it('ignores a window missing from the snapshot', async () => {
    await notify.execute(ACCOUNT, snapshot(null, 10));
    await notify.execute(ACCOUNT, snapshot(null, 60));
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['7d usage at 60%']);
  });

  it('notifies again after the cycle restarts', async () => {
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(60, 10));
    await notify.execute(ACCOUNT, snapshot(5, 10, START + 6 * 3_600_000));
    await notify.execute(ACCOUNT, snapshot(60, 10, START + 6 * 3_600_000));
    expect(notifier.sent).toHaveLength(2);
  });
});

describe('NotifyUsageQuartiles per account', () => {
  it('keeps one state per account: crossing on one account does not count for the other', async () => {
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(60, 10));
    activate(WORK.id);
    await notify.execute(WORK.id, snapshot(47, 10));
    await notify.execute(WORK.id, snapshot(52, 10));
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['5h usage at 60%', '5h usage at 52%']);
  });

  it('the first reading after switching accounts is silent even when that account already has a state', async () => {
    await notify.execute(ACCOUNT, snapshot(10, 10));
    activate(WORK.id);
    await notify.execute(WORK.id, snapshot(10, 10));
    activate(ACCOUNT);
    await notify.execute(ACCOUNT, snapshot(60, 10));
    expect(notifier.sent).toEqual([]);
  });

  it('a late reading of the previous account does not make the next reading of the active one count as a continuation', async () => {
    await notify.execute(ACCOUNT, snapshot(10, 10));
    activate(WORK.id);
    await notify.execute(WORK.id, snapshot(10, 10));
    activate(ACCOUNT);
    activate(WORK.id);
    await notify.execute(ACCOUNT, snapshot(12, 10));
    await notify.execute(WORK.id, snapshot(80, 10));
    expect(notifier.sent).toEqual([]);
  });

  it('switching back is silent too', async () => {
    await notify.execute(ACCOUNT, snapshot(10, 10));
    await notify.execute(ACCOUNT, snapshot(55, 10));
    activate(WORK.id);
    await notify.execute(WORK.id, snapshot(10, 10));
    activate(ACCOUNT);
    await notify.execute(ACCOUNT, snapshot(80, 10));
    await notify.execute(ACCOUNT, snapshot(85, 10));
    expect(notifier.sent.map((notice) => notice.title)).toEqual(['5h usage at 55%']);
  });

  it('ignores a reading of an account that is no longer active', async () => {
    await notify.execute(ACCOUNT, snapshot(10, 10));
    activate(WORK.id);
    await notify.execute(ACCOUNT, snapshot(90, 90));
    activate(ACCOUNT);
    await notify.execute(ACCOUNT, snapshot(95, 95));
    expect(notifier.sent).toEqual([]);
  });
});
