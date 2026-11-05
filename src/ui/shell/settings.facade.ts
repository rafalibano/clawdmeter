import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { createDefaultSettings, applyPatch, mergePatches, type AppSettings, type SettingsPatch } from '../../domain/settings';
import { APPLICATION } from './application.token';

@Injectable({ providedIn: 'root' })
export class SettingsFacade {
  private readonly app = inject(APPLICATION);
  private readonly state = signal<AppSettings>(createDefaultSettings());
  private readonly loaded = signal(false);
  private pending: SettingsPatch[] = [];
  private flushing = false;

  readonly settings = this.state.asReadonly();
  readonly ready = this.loaded.asReadonly();
  readonly pages = computed(() => this.app.registry.all());
  readonly enabledPages = computed(() => this.app.registry.enabled(this.state()));

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      if (this.loaded()) this.app.scheduler.sync(this.state());
    });
    destroyRef.onDestroy(() => this.app.scheduler.stopAll());
    void this.start(destroyRef);
  }

  update(patch: SettingsPatch): void {
    this.state.update((current) => applyPatch(current, patch));
    this.pending.push(patch);
    if (!this.flushing) void this.flush();
  }

  private async start(destroyRef: DestroyRef): Promise<void> {
    this.state.set(await this.app.getSettings.execute());
    this.loaded.set(true);
    const stop = await this.app.watchSettings.execute((settings) => this.state.set(settings));
    destroyRef.onDestroy(stop);
  }

  private async flush(): Promise<void> {
    this.flushing = true;
    try {
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0).reduce(mergePatches);
        await this.app.updateSettings.execute(batch);
      }
    } finally {
      this.flushing = false;
    }
  }
}
