import { RateLimitedError, rateLimitDelay } from '../../domain/rate-limit';
import type { AppSettings } from '../../domain/settings';
import { MINUTE_MS } from '../../domain/time';
import type { Clock, Unsubscribe } from '../ports';
import type { LoadUsageResets, UsageResetsData } from '../use-cases/usage/load-usage-resets';

export const USAGE_RESETS_POLL_INTERVAL_MS = 15 * MINUTE_MS;

type ResetsListener = (data: UsageResetsData | null) => void;

export class UsageResetsMonitor {
  private data: UsageResetsData | null = null;
  private readonly listeners = new Set<ResetsListener>();
  private stopTimer: (() => void) | null = null;
  private watching: string | null = null;
  private generation = 0;
  private inflight: number | null = null;
  private failures = 0;
  private blockedUntil = 0;

  constructor(
    private readonly loader: LoadUsageResets | null,
    private readonly clock: Clock,
  ) {}

  get current(): UsageResetsData | null {
    return this.data;
  }

  subscribe(listener: ResetsListener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.data);
    return () => this.listeners.delete(listener);
  }

  sync(settings: AppSettings): void {
    const accountId = this.loader !== null && settings.usageBlocks.resets ? settings.claude.activeAccountId : null;
    if (accountId === this.watching) return;
    this.stopWatching();
    this.watching = accountId;
    if (accountId === null) return;
    this.stopTimer = this.clock.every(USAGE_RESETS_POLL_INTERVAL_MS, () => void this.refresh());
    void this.refresh();
  }

  stop(): void {
    this.stopWatching();
    this.watching = null;
  }

  private stopWatching(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.generation += 1;
    this.failures = 0;
    this.blockedUntil = 0;
    this.publish(null);
  }

  private async refresh(): Promise<void> {
    const generation = this.generation;
    if (this.loader === null || this.inflight === generation || this.clock.now() < this.blockedUntil) return;
    this.inflight = generation;
    try {
      const data = await this.loader.execute();
      if (generation !== this.generation) return;
      this.failures = 0;
      this.publish(data?.resets ? data : null);
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof RateLimitedError) {
        this.failures += 1;
        this.blockedUntil = this.clock.now() + rateLimitDelay(this.failures, error.retryAfterMs);
      }
      this.publish(null);
    } finally {
      if (this.inflight === generation) this.inflight = null;
    }
  }

  private publish(data: UsageResetsData | null): void {
    if (data === this.data) return;
    this.data = data;
    for (const listener of this.listeners) listener(data);
  }
}
