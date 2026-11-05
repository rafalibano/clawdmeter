import { CodedError, type ErrorArgs, type ErrorCode } from '../../domain/coded-error';
import { ConnectionProblemError, type ConnectionProblem } from '../../domain/connections';
import { RateLimitedError, rateLimitDelay } from '../../domain/rate-limit';
import type { AppSettings, PageId } from '../../domain/settings';
import type { PageModule } from '../pages/page-module';
import type { PageRegistry } from '../pages/page-registry';
import type { Clock, Unsubscribe } from '../ports';

export type PageUpdate<T = unknown> =
  | { pageId: PageId; status: 'ok'; data: T; at: number }
  | { pageId: PageId; status: 'error'; error: string; problem?: ConnectionProblem; code?: ErrorCode; args?: ErrorArgs; rateLimitedUntil?: number; at: number };

type PageUpdateListener = (update: PageUpdate) => void;

interface Run {
  cancel: Unsubscribe;
  inflight: Promise<void> | null;
  pending: boolean;
  rateLimitFailures: number;
  blockedUntil: number;
}

export class PollingScheduler {
  private readonly runs = new Map<PageId, Run>();
  private readonly listeners = new Set<PageUpdateListener>();
  private readonly latest = new Map<PageId, PageUpdate>();

  constructor(
    private readonly registry: PageRegistry,
    private readonly clock: Clock,
  ) {}

  subscribe(listener: PageUpdateListener): Unsubscribe {
    this.listeners.add(listener);
    for (const update of this.latest.values()) listener(update);
    return () => this.listeners.delete(listener);
  }

  sync(settings: AppSettings): void {
    const enabled = this.registry.enabled(settings);
    const enabledIds = new Set(enabled.map((page) => page.id));
    for (const [id, run] of this.runs) {
      if (enabledIds.has(id)) continue;
      run.cancel();
      this.runs.delete(id);
      this.latest.delete(id);
    }
    for (const page of enabled) {
      if (!this.runs.has(page.id)) this.start(page);
    }
  }

  refresh(pageId: PageId): Promise<void> {
    const page = this.registry.get(pageId);
    const run = this.runs.get(pageId);
    return page && run ? this.poll(page, run, true) : Promise.resolve();
  }

  stopAll(): void {
    for (const run of this.runs.values()) run.cancel();
    this.runs.clear();
    this.latest.clear();
  }

  private start(page: PageModule): void {
    const run: Run = { cancel: () => undefined, inflight: null, pending: false, rateLimitFailures: 0, blockedUntil: 0 };
    this.runs.set(page.id, run);
    void this.poll(page, run, false);
    if (page.pollIntervalMs !== null) {
      run.cancel = this.clock.every(page.pollIntervalMs, () => void this.poll(page, run, false));
    }
  }

  backoffUntil(pageId: PageId): number | null {
    const run = this.runs.get(pageId);
    return run && run.blockedUntil > this.clock.now() ? run.blockedUntil : null;
  }

  private poll(page: PageModule, run: Run, queueIfBusy: boolean): Promise<void> {
    if (run.blockedUntil > this.clock.now()) return run.inflight ?? Promise.resolve();
    if (run.inflight) {
      if (queueIfBusy) run.pending = true;
      return run.inflight;
    }
    const inflight = this.drain(page, run);
    run.inflight = inflight;
    return inflight;
  }

  private async drain(page: PageModule, run: Run): Promise<void> {
    try {
      do {
        run.pending = false;
        await this.load(page, run);
      } while (run.pending && this.runs.get(page.id) === run);
    } finally {
      run.inflight = null;
    }
  }

  private async load(page: PageModule, run: Run): Promise<void> {
    try {
      const data = await page.load();
      run.rateLimitFailures = 0;
      run.blockedUntil = 0;
      this.publish(page, run, { pageId: page.id, status: 'ok', data, at: this.clock.now() });
    } catch (error) {
      const now = this.clock.now();
      let rateLimitedUntil: number | undefined;
      if (error instanceof RateLimitedError) {
        run.rateLimitFailures += 1;
        run.blockedUntil = now + rateLimitDelay(run.rateLimitFailures, error.retryAfterMs);
        rateLimitedUntil = run.blockedUntil;
      }
      this.publish(page, run, {
        ...describeFailure(error),
        ...(rateLimitedUntil === undefined ? {} : { rateLimitedUntil }),
        pageId: page.id,
        status: 'error',
        at: now,
      });
    }
  }

  private publish(page: PageModule, run: Run, update: PageUpdate): void {
    if (this.runs.get(page.id) !== run) return;
    this.latest.set(page.id, update);
    for (const listener of this.listeners) listener(update);
  }
}

function describeFailure(error: unknown): { error: string; problem?: ConnectionProblem; code?: ErrorCode; args?: ErrorArgs } {
  if (error instanceof ConnectionProblemError) {
    return {
      error: error.message,
      problem: error.problem,
      ...(error.code ? { code: error.code } : {}),
      ...(error.args ? { args: error.args } : {}),
    };
  }
  if (error instanceof CodedError) return { error: error.message, code: error.code, ...(error.args ? { args: error.args } : {}) };
  return { error: error instanceof Error ? error.message : String(error) };
}
