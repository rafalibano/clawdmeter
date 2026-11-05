import type { AppSettings, PageId } from '../../domain/settings';
import type { PageModule } from '../pages/page-module';
import type { PageRegistry } from '../pages/page-registry';
import type { Clock, Unsubscribe } from '../ports';

export type PageUpdate<T = unknown> =
  | { pageId: PageId; status: 'ok'; data: T; at: number }
  | { pageId: PageId; status: 'error'; error: string; at: number };

type PageUpdateListener = (update: PageUpdate) => void;

interface Run {
  cancel: Unsubscribe;
  busy: boolean;
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
    return page && run ? this.poll(page, run) : Promise.resolve();
  }

  stopAll(): void {
    for (const run of this.runs.values()) run.cancel();
    this.runs.clear();
    this.latest.clear();
  }

  private start(page: PageModule): void {
    const run: Run = { cancel: () => undefined, busy: false };
    this.runs.set(page.id, run);
    void this.poll(page, run);
    if (page.pollIntervalMs !== null) {
      run.cancel = this.clock.every(page.pollIntervalMs, () => void this.poll(page, run));
    }
  }

  private async poll(page: PageModule, run: Run): Promise<void> {
    if (run.busy) return;
    run.busy = true;
    try {
      const data = await page.load();
      this.publish(page, run, { pageId: page.id, status: 'ok', data, at: this.clock.now() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.publish(page, run, { pageId: page.id, status: 'error', error: message, at: this.clock.now() });
    } finally {
      run.busy = false;
    }
  }

  private publish(page: PageModule, run: Run, update: PageUpdate): void {
    if (this.runs.get(page.id) !== run) return;
    this.latest.set(page.id, update);
    for (const listener of this.listeners) listener(update);
  }
}
