import type { UsageGateway, UsageHistoryStore } from '../../application/ports';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../domain/time';
import { createEmptyHistory, retainHistory, type UsageHistory, type UsageSnapshot } from '../../domain/usage';

const FIVE_HOUR_MS = 5 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const WEEKLY_SHARE = 0.12;
const CURRENT_WINDOW_TOTAL = 80;
const IDLE_BELOW = 8;
const SAMPLE_STEP_MS = MINUTE_MS;

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

  constructor(readonly origin: number) {
    this.fiveHourAnchor = origin - 1.5 * HOUR_MS;
    this.weekAnchor = origin - 3 * DAY_MS - 5 * HOUR_MS;
  }

  snapshotAt(at: number): UsageSnapshot {
    const windowIndex = this.windowIndexAt(at);
    const windowStart = this.windowStart(windowIndex);
    const weekStart = this.weekAnchor + Math.floor((at - this.weekAnchor) / WEEK_MS) * WEEK_MS;
    return {
      fiveHour: { utilization: this.windowValue(windowIndex, at), resetsAt: windowStart + FIVE_HOUR_MS },
      sevenDay: { utilization: this.weekValue(weekStart, at), resetsAt: weekStart + WEEK_MS },
    };
  }

  history(now: number): UsageHistory {
    const history = createEmptyHistory();
    const from = Math.ceil((now - 30 * DAY_MS) / SAMPLE_STEP_MS) * SAMPLE_STEP_MS;
    for (let at = from; at < now; at += SAMPLE_STEP_MS) {
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
    if (index === 0) return CURRENT_WINDOW_TOTAL;
    const middle = new Date(this.windowStart(index) + FIVE_HOUR_MS / 2);
    const total = 110 * hash(index, 1) * weekdayFactor(middle.getDay()) * hourFactor(middle.getHours());
    return total < IDLE_BELOW ? 0 : total;
  }

  private windowValue(index: number, at: number): number {
    const elapsed = Math.min(1, Math.max(0, (at - this.windowStart(index)) / FIVE_HOUR_MS));
    const curve = 0.7 + 0.9 * hash(index, 2);
    return Math.min(100, this.windowTotal(index) * elapsed ** curve);
  }

  private weekValue(weekStart: number, at: number): number {
    const first = this.windowIndexAt(weekStart) + 1;
    const last = this.windowIndexAt(at);
    let total = 0;
    for (let index = first; index <= last; index++) total += this.windowValue(index, at) * WEEKLY_SHARE;
    return Math.min(100, total);
  }
}

export class DemoUsageGateway implements UsageGateway {
  constructor(
    private readonly model: DemoUsageModel,
    private readonly now: () => number = Date.now,
  ) {}

  async fetch(): Promise<UsageSnapshot> {
    return this.model.snapshotAt(this.now());
  }
}

export class DemoUsageHistoryStore implements UsageHistoryStore {
  constructor(private history: UsageHistory) {}

  async load(): Promise<UsageHistory> {
    return this.history;
  }

  async save(history: UsageHistory): Promise<void> {
    this.history = history;
  }
}
