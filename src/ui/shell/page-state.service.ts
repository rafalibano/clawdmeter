import { DestroyRef, Injectable, computed, inject, signal, type Signal } from '@angular/core';
import type { PageId } from '../../domain/settings';
import type { PageUpdate } from '../../application/scheduler';
import { APPLICATION } from './application.token';

@Injectable({ providedIn: 'root' })
export class PageStateService {
  private readonly updates = signal<ReadonlyMap<PageId, PageUpdate>>(new Map());

  constructor() {
    const stop = inject(APPLICATION).scheduler.subscribe((update) =>
      this.updates.update((current) => new Map(current).set(update.pageId, update)),
    );
    inject(DestroyRef).onDestroy(stop);
  }

  of(id: PageId): Signal<PageUpdate | undefined> {
    return computed(() => this.updates().get(id));
  }
}
