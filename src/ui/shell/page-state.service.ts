import { DestroyRef, Injectable, computed, inject, signal, type Signal } from '@angular/core';
import type { PageId } from '../../domain/settings';
import type { PageRef } from '../../application/pages';
import type { PageUpdate } from '../../application/scheduler';
import { APPLICATION } from './application.token';

@Injectable({ providedIn: 'root' })
export class PageStateService {
  private readonly updates = signal<ReadonlyMap<PageId, PageUpdate>>(new Map());
  private readonly lastData = signal<ReadonlyMap<PageId, unknown>>(new Map());

  constructor() {
    const stop = inject(APPLICATION).scheduler.subscribe((update) => {
      this.updates.update((current) => new Map(current).set(update.pageId, update));
      if (update.status === 'ok') this.lastData.update((current) => new Map(current).set(update.pageId, update.data));
    });
    inject(DestroyRef).onDestroy(stop);
  }

  get<T>(page: PageRef<T>): PageUpdate<T> | undefined {
    return this.updates().get(page.id) as PageUpdate<T> | undefined;
  }

  of<T>(page: PageRef<T>): Signal<PageUpdate<T> | undefined> {
    return computed(() => this.get(page));
  }

  lastOk<T>(page: PageRef<T>): Signal<T | undefined> {
    return computed(() => this.lastData().get(page.id) as T | undefined);
  }
}
