import type { ConnectionId, ConnectionStatus } from '../../domain/connections';
import { RateLimitedError, rateLimitDelay } from '../../domain/rate-limit';
import { effectiveClaudeClientId, type AppSettings } from '../../domain/settings';
import { MINUTE_MS } from '../../domain/time';
import type { Clock, Unsubscribe } from '../ports';
import type { LoadUsageResets, UsageResetsData, UsageResetsTarget } from '../use-cases/usage/load-usage-resets';

export const USAGE_RESETS_POLL_INTERVAL_MS = 15 * MINUTE_MS;

type ResetsListener = (data: UsageResetsData | null) => void;

export interface ConnectionStatusSource {
  subscribe(listener: (id: ConnectionId, status: ConnectionStatus) => void): Unsubscribe;
}

export class UsageResetsMonitor {
  private data: UsageResetsData | null = null;
  private readonly listeners = new Set<ResetsListener>();
  private stopTimer: (() => void) | null = null;
  private unwatchConnection: Unsubscribe | null = null;
  private target: UsageResetsTarget | null = null;
  private key: string | null = null;
  private generation = 0;
  private inflight: number | null = null;
  private claudeDisconnected = false;
  private backoffAccount: string | null = null;
  private failures = 0;
  private blockedUntil = 0;

  constructor(
    private readonly loader: LoadUsageResets | null,
    private readonly clock: Clock,
    private readonly connections: ConnectionStatusSource | null = null,
  ) {}

  get current(): UsageResetsData | null {
    return this.data;
  }

  subscribe(listener: ResetsListener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.data);
    return () => this.listeners.delete(listener);
  }

  sync(settings: AppSettings, usagePageEnabled: boolean): void {
    this.watchConnection();
    const accountId = settings.claude.activeAccountId;
    const wanted = this.loader !== null && usagePageEnabled && settings.usageBlocks.resets && accountId !== null;
    const target = wanted ? { accountId, clientId: effectiveClaudeClientId(settings.claude) } : null;
    const key = target === null ? null : `${target.accountId} ${target.clientId}`;
    if (key === this.key) return;
    this.stopWatching();
    this.key = key;
    this.target = target;
    if (target === null) return;
    if (this.backoffAccount !== target.accountId) {
      this.backoffAccount = target.accountId;
      this.failures = 0;
      this.blockedUntil = 0;
    }
    this.stopTimer = this.clock.every(USAGE_RESETS_POLL_INTERVAL_MS, () => void this.refresh());
    void this.refresh();
  }

  stop(): void {
    this.stopWatching();
    this.key = null;
    this.target = null;
    this.unwatchConnection?.();
    this.unwatchConnection = null;
  }

  private stopWatching(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.generation += 1;
    this.publish(null);
  }

  private watchConnection(): void {
    if (this.connections === null || this.unwatchConnection !== null) return;
    this.unwatchConnection = this.connections.subscribe((id, status) => this.onConnection(id, status));
  }

  private onConnection(id: ConnectionId, status: ConnectionStatus): void {
    if (id !== 'claude') return;
    const disconnected = status.state === 'disconnected';
    const reconnected = this.claudeDisconnected && !disconnected;
    this.claudeDisconnected = disconnected;
    if (disconnected) this.publish(null);
    else if (reconnected && this.target !== null) void this.refresh();
  }

  private async refresh(): Promise<void> {
    const { generation, target } = this;
    if (this.loader === null || target === null || this.inflight === generation || this.clock.now() < this.blockedUntil) return;
    this.inflight = generation;
    try {
      const data = await this.loader.execute(target);
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
