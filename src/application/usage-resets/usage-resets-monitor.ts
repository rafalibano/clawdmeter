import type { ConnectionId, ConnectionStatus } from '../../domain/connections';
import { RateLimitedError, rateLimitDelay } from '../../domain/rate-limit';
import { effectiveClaudeClientId, type AppSettings } from '../../domain/settings';
import { MINUTE_MS } from '../../domain/time';
import type { Clock, Unsubscribe } from '../ports';
import type { LoadUsageResets, UsageResetsData, UsageResetsTarget } from '../use-cases/usage/load-usage-resets';

export const USAGE_RESETS_POLL_INTERVAL_MS = 15 * MINUTE_MS;

type ResetsListener = (data: UsageResetsData | null) => void;

interface Backoff {
  failures: number;
  blockedUntil: number;
}

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
  private claudeState: ConnectionStatus['state'] | null = null;
  private readonly backoffs = new Map<string, Backoff>();

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
    this.hide();
  }

  private hide(): void {
    this.generation += 1;
    this.publish(null);
  }

  private watchConnection(): void {
    if (this.connections === null || this.unwatchConnection !== null) return;
    this.unwatchConnection = this.connections.subscribe((id, status) => this.onConnection(id, status));
  }

  private onConnection(id: ConnectionId, status: ConnectionStatus): void {
    if (id !== 'claude') return;
    const previous = this.claudeState;
    this.claudeState = status.state;
    if (status.state === 'disconnected' || status.state === 'error') this.hide();
    else if (status.state === 'connected' && previous !== 'connected' && this.target !== null && this.data === null) void this.refresh();
  }

  private async refresh(): Promise<void> {
    const { generation, target } = this;
    if (this.loader === null || target === null || this.inflight === generation) return;
    if (this.clock.now() < (this.backoffs.get(target.accountId)?.blockedUntil ?? 0)) return;
    this.inflight = generation;
    try {
      const data = await this.loader.execute(target);
      this.backoffs.delete(target.accountId);
      if (generation === this.generation) this.publish(data?.resets ? data : null);
    } catch (error) {
      if (error instanceof RateLimitedError) this.backOff(target.accountId, error.retryAfterMs);
      if (generation === this.generation) this.publish(null);
    } finally {
      if (this.inflight === generation) this.inflight = null;
    }
  }

  private backOff(accountId: string, retryAfterMs: number | null): void {
    const failures = (this.backoffs.get(accountId)?.failures ?? 0) + 1;
    this.backoffs.set(accountId, { failures, blockedUntil: this.clock.now() + rateLimitDelay(failures, retryAfterMs) });
  }

  private publish(data: UsageResetsData | null): void {
    if (data === this.data) return;
    this.data = data;
    for (const listener of this.listeners) listener(data);
  }
}
