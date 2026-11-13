import type {
  ExternalUsageHistorySource,
  UsageGateway,
  UsageHistoryStore,
  UsageHistoryStores,
  UsageResetsGateway,
} from '../../application/ports';
import { ConnectionProblemError } from '../../domain/connections';
import { RateLimitedError } from '../../domain/rate-limit';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../domain/time';
import {
  createEmptyHistory,
  retainHistory,
  type ExternalUsagePoint,
  type UsageHistory,
  type UsageResets,
  type UsageSnapshot,
} from '../../domain/usage';

const FIVE_HOUR_MS = 5 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const WEEKLY_SHARE = 0.12;
const CURRENT_WINDOW_TOTAL = 80;
const OTHER_ACCOUNT_WINDOW_TOTAL = 45;
const SALT_STRIDE = 10;
const HIGH_WEEKLY_SHARE = 0.21;
const HIGH_CURRENT_WINDOW_TOTAL = 195;
const IDLE_BELOW = 8;
const SAMPLE_STEP_MS = MINUTE_MS;
const GAP_START_AGO_MS = 4 * DAY_MS;
const GAP_END_AGO_MS = 2.5 * DAY_MS;
const FABLE_WEEKLY_SHARE = 0.55;
const SONNET_WEEKLY_SHARE = 0.3;
const EXTRA_USED_MINOR = 4_250;
const EXTRA_LIMIT_MINOR = 10_000;

function hash(index: number, salt: number): number {
  let value = Math.imul(index + 100_000, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 0x100000000;
}

function weekdayFactor(day: number): number {
  if (day === 0) return 0.1;
  return day === 6 ? 0.25 : 1;
}

function hourFactor(hour: number): number {
  if (hour < 7) return 0.05;
  if (hour < 12) return 1;
  if (hour < 14) return 0.7;
  if (hour < 19) return 1;
  return hour < 23 ? 0.3 : 0.05;
}

export class DemoUsageModel {
  private readonly fiveHourAnchor: number;
  private readonly weekAnchor: number;

  constructor(
    readonly origin: number,
    private readonly high = false,
    private readonly seed = 0,
  ) {
    this.fiveHourAnchor = origin - 1.5 * HOUR_MS;
    this.weekAnchor = origin - 3 * DAY_MS - 5 * HOUR_MS;
  }

  snapshotAt(at: number): UsageSnapshot {
    const windowIndex = this.windowIndexAt(at);
    const windowStart = this.windowStart(windowIndex);
    const weekStart = this.weekAnchor + Math.floor((at - this.weekAnchor) / WEEK_MS) * WEEK_MS;
    const weekly = this.weekValue(weekStart, at);
    const weekResetsAt = weekStart + WEEK_MS;
    return {
      fiveHour: { utilization: this.windowValue(windowIndex, at), resetsAt: windowStart + FIVE_HOUR_MS },
      sevenDay: { utilization: weekly, resetsAt: weekResetsAt },
      modelLimits: [
        { name: 'Fable', utilization: weekly * FABLE_WEEKLY_SHARE, resetsAt: weekResetsAt },
        { name: 'Sonnet', utilization: weekly * SONNET_WEEKLY_SHARE, resetsAt: weekResetsAt },
      ],
      extraUsage: {
        enabled: true,
        usedMinor: EXTRA_USED_MINOR,
        limitMinor: EXTRA_LIMIT_MINOR,
        percent: (EXTRA_USED_MINOR / EXTRA_LIMIT_MINOR) * 100,
        currency: 'USD',
        exponent: 2,
      },
    };
  }

  history(now: number): UsageHistory {
    const history = createEmptyHistory();
    const from = Math.ceil((now - 30 * DAY_MS) / SAMPLE_STEP_MS) * SAMPLE_STEP_MS;
    for (let at = from; at < now; at += SAMPLE_STEP_MS) {
      if (at > now - GAP_START_AGO_MS && at < now - GAP_END_AGO_MS) continue;
      const { fiveHour, sevenDay } = this.snapshotAt(at);
      history.fiveHour.push({ at, utilization: fiveHour!.utilization, resetsAt: fiveHour!.resetsAt });
      history.sevenDay.push({ at, utilization: sevenDay!.utilization, resetsAt: sevenDay!.resetsAt });
    }
    return retainHistory(history, now);
  }

  private windowIndexAt(at: number): number {
    return Math.floor((at - this.fiveHourAnchor) / FIVE_HOUR_MS);
  }

  private windowStart(index: number): number {
    return this.fiveHourAnchor + index * FIVE_HOUR_MS;
  }

  private windowTotal(index: number): number {
    if (index === 0) return this.high ? HIGH_CURRENT_WINDOW_TOTAL : this.seed === 0 ? CURRENT_WINDOW_TOTAL : OTHER_ACCOUNT_WINDOW_TOTAL;
    const middle = new Date(this.windowStart(index) + FIVE_HOUR_MS / 2);
    const total = 110 * hash(index, 1 + this.seed * SALT_STRIDE) * weekdayFactor(middle.getDay()) * hourFactor(middle.getHours());
    return total < IDLE_BELOW ? 0 : total;
  }

  private windowValue(index: number, at: number): number {
    const elapsed = Math.min(1, Math.max(0, (at - this.windowStart(index)) / FIVE_HOUR_MS));
    const curve = 0.7 + 0.9 * hash(index, 2 + this.seed * SALT_STRIDE);
    return Math.min(100, this.windowTotal(index) * elapsed ** curve);
  }

  private weekValue(weekStart: number, at: number): number {
    const first = this.windowIndexAt(weekStart) + 1;
    const last = this.windowIndexAt(at);
    let total = 0;
    for (let index = first; index <= last; index++) total += this.windowValue(index, at) * (this.high ? HIGH_WEEKLY_SHARE : WEEKLY_SHARE);
    return Math.min(100, total);
  }
}

export class DemoUsageModels {
  private readonly models = new Map<string, DemoUsageModel>();

  constructor(
    readonly origin: number,
    private readonly primaryAccountId: string,
    private readonly high = false,
  ) {}

  forAccount(accountId: string): DemoUsageModel {
    const known = this.models.get(accountId);
    if (known !== undefined) return known;
    const primary = accountId === this.primaryAccountId;
    const created = new DemoUsageModel(this.origin, primary && this.high, primary ? 0 : 1 + this.models.size);
    this.models.set(accountId, created);
    return created;
  }
}

export interface DemoSignIn {
  requiresSignIn(accountId: string): boolean;
}

export class DemoUsageGateway implements UsageGateway {
  constructor(
    private readonly models: DemoUsageModels,
    private readonly now: () => number = Date.now,
    private readonly accounts?: DemoSignIn,
    private readonly rateLimitedAfterFirst = false,
  ) {}

  private calls = 0;

  async fetch(accountId: string): Promise<UsageSnapshot> {
    this.calls += 1;
    if (this.rateLimitedAfterFirst && this.calls > 1) throw new RateLimitedError(12 * MINUTE_MS);
    if (this.accounts?.requiresSignIn(accountId)) throw new ConnectionProblemError('claude-signin-required');
    return this.models.forAccount(accountId).snapshotAt(this.now());
  }
}

export class DemoUsageResetsGateway implements UsageResetsGateway {
  constructor(private readonly now: () => number = Date.now) {}

  async fetch(): Promise<UsageResets | null> {
    const now = this.now();
    return {
      atLimit: false,
      exhausted: [],
      grants: [
        {
          id: 'demo-session',
          label: null,
          type: 'session',
          resetsLeft: 2,
          resetsTotal: 3,
          startsAt: now - DAY_MS,
          endsAt: now + 2 * DAY_MS,
          clears: ['fiveHour'],
          paused: false,
          usableNow: true,
        },
        {
          id: 'demo-weekly',
          label: null,
          type: 'weekly',
          resetsLeft: 1,
          resetsTotal: 1,
          startsAt: now - 2 * DAY_MS,
          endsAt: now + 5 * DAY_MS,
          clears: ['sevenDay'],
          paused: false,
          usableNow: true,
        },
        {
          id: 'demo-full',
          label: null,
          type: 'full',
          resetsLeft: 1,
          resetsTotal: 1,
          startsAt: now + DAY_MS,
          endsAt: now + 9 * DAY_MS,
          clears: ['fiveHour', 'sevenDay'],
          paused: false,
          usableNow: false,
        },
      ],
    };
  }
}

export class DemoUsageHistoryStores implements UsageHistoryStores {
  private readonly stores = new Map<string, DemoUsageHistoryStore>();

  constructor(private readonly models: DemoUsageModels) {}

  forAccount(accountId: string): DemoUsageHistoryStore {
    const known = this.stores.get(accountId);
    if (known !== undefined) return known;
    const created = new DemoUsageHistoryStore(this.models.forAccount(accountId).history(this.models.origin));
    this.stores.set(accountId, created);
    return created;
  }

  async adoptLegacy(): Promise<boolean> {
    return false;
  }

  async releaseLegacy(): Promise<void> {
    return undefined;
  }

  async remove(accountId: string): Promise<void> {
    this.stores.delete(accountId);
  }
}

export class DemoUsageHistoryStore implements UsageHistoryStore {
  private imported: number | null = null;

  constructor(private history: UsageHistory) {}

  async importedAt(): Promise<number | null> {
    return this.imported;
  }

  async markImported(at: number): Promise<void> {
    this.imported = at;
  }

  async load(): Promise<UsageHistory> {
    return this.history;
  }

  async save(history: UsageHistory): Promise<void> {
    this.history = history;
  }
}

export class DemoExternalUsageHistorySource implements ExternalUsageHistorySource {
  async read(): Promise<ExternalUsagePoint[]> {
    return [];
  }
}
