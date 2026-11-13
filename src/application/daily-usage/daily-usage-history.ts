import type { AppSettings } from '../../domain/settings';
import type { DailyUsage } from '../../domain/usage';
import { MINUTE_MS } from '../../domain/time';
import type { Clock, Unsubscribe } from '../ports';
import type { LoadDailyUsage } from '../use-cases/usage/load-daily-usage';

export const DAILY_USAGE_POLL_MS = 10 * MINUTE_MS;

type Listener = (usage: DailyUsage | null) => void;

export class DailyUsageHistory {
  private snapshot: DailyUsage | null = null;
  private readonly listeners = new Set<Listener>();
  private stopTimer: (() => void) | null = null;
  private generation = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly load: LoadDailyUsage | undefined,
    private readonly clock: Clock,
  ) {}

  get current(): DailyUsage | null {
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
      void this.refresh();
    } else if (!wanted && this.stopTimer !== null) {
      this.stop();
    }
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.generation += 1;
    this.publish(null);
  }

  refresh(): Promise<void> {
    if (this.stopTimer === null) return Promise.resolve();
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<void> {
    const generation = this.generation;
    let usage: DailyUsage | null;
    try {
      usage = (await this.load?.execute()) ?? null;
    } catch {
      usage = null;
    }
    if (generation === this.generation) this.publish(usage);
  }

  private publish(usage: DailyUsage | null): void {
    if (usage === this.snapshot) return;
    this.snapshot = usage;
    for (const listener of this.listeners) listener(usage);
  }
}
