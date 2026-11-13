import type { AppSettings } from '../../domain/settings';
import type { DailyUsage } from '../../domain/usage';
import { MINUTE_MS } from '../../domain/time';
import type { Clock, Unsubscribe } from '../ports';
import type { LoadDailyUsage } from '../use-cases/usage/load-daily-usage';

export const DAILY_USAGE_POLL_MS = 10 * MINUTE_MS;

export type DailyUsageState = { status: 'loading' } | { status: 'ready'; usage: DailyUsage };

type Listener = (state: DailyUsageState | null) => void;

const LOADING: DailyUsageState = { status: 'loading' };

export class DailyUsageHistory {
  private snapshot: DailyUsageState | null = null;
  private readonly listeners = new Set<Listener>();
  private stopTimer: (() => void) | null = null;
  private generation = 0;
  private inflight: { generation: number; promise: Promise<void> } | null = null;

  constructor(
    private readonly load: LoadDailyUsage | undefined,
    private readonly clock: Clock,
  ) {}

  get current(): DailyUsageState | null {
    return this.snapshot;
  }

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  sync(settings: AppSettings, usagePageEnabled: boolean): void {
    const wanted = this.load !== undefined && usagePageEnabled && settings.usageDailyHistory;
    if (wanted && this.stopTimer === null) {
      this.stopTimer = this.clock.every(DAILY_USAGE_POLL_MS, () => void this.refresh());
      this.publish(LOADING);
      void this.refresh();
    } else if (!wanted && this.stopTimer !== null) {
      this.stop();
    }
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.generation += 1;
    this.inflight = null;
    this.publish(null);
  }

  refresh(): Promise<void> {
    if (this.stopTimer === null) return Promise.resolve();
    if (this.inflight?.generation === this.generation) return this.inflight.promise;
    const generation = this.generation;
    const promise: Promise<void> = this.run(generation).finally(() => {
      if (this.inflight?.promise === promise) this.inflight = null;
    });
    this.inflight = { generation, promise };
    return promise;
  }

  private async run(generation: number): Promise<void> {
    let usage: DailyUsage | null;
    try {
      usage = (await this.load?.execute()) ?? null;
    } catch {
      usage = null;
    }
    if (generation === this.generation) this.publish(usage === null ? null : { status: 'ready', usage });
  }

  private publish(state: DailyUsageState | null): void {
    if (state === this.snapshot) return;
    this.snapshot = state;
    for (const listener of this.listeners) listener(state);
  }
}
