import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { shouldShowUpdateBanner, type UpdateSnapshot } from '../../domain/updates';
import { APPLICATION } from '../shell/application.token';

@Injectable({ providedIn: 'root' })
export class UpdatesFacade {
  private readonly updates = inject(APPLICATION).updates;
  private readonly state = signal<UpdateSnapshot>(this.updates.current);
  private readonly dismissed = signal(false);

  readonly snapshot = this.state.asReadonly();
  readonly showBanner = computed(() => !this.dismissed() && shouldShowUpdateBanner(this.state().status));

  constructor() {
    const unsubscribe = this.updates.subscribe((snapshot) => this.state.set(snapshot));
    const stop = this.updates.start();
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      stop();
    });
  }

  checkNow(): Promise<void> {
    this.dismissed.set(false);
    return this.updates.checkNow();
  }

  install(): Promise<void> {
    this.dismissed.set(false);
    return this.updates.install();
  }

  restart(): Promise<void> {
    return this.updates.restart();
  }

  dismiss(): void {
    this.dismissed.set(true);
  }
}
