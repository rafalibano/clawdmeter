import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { createDefaultSettings, type AppSettings, type SettingsPatch } from '../../domain/settings';
import { SettingsSession, type SettingsSessionError } from '../../application/session';
import { APPLICATION } from './application.token';

@Injectable({ providedIn: 'root' })
export class SettingsFacade {
  private readonly app = inject(APPLICATION);
  private readonly state = signal<AppSettings>(createDefaultSettings());
  private readonly loaded = signal(false);
  private readonly failure = signal<SettingsSessionError | null>(null);
  private readonly session = new SettingsSession(this.app, (state) => {
    this.state.set(state.settings);
    this.loaded.set(state.ready);
    this.failure.set(state.error);
  });

  readonly settings = this.state.asReadonly();
  readonly ready = this.loaded.asReadonly();
  readonly error = this.failure.asReadonly();
  readonly pages = computed(() => this.app.registry.all());
  readonly enabledPages = computed(() => this.app.registry.enabled(this.state()));

  constructor() {
    effect(() => {
      if (this.loaded()) this.app.scheduler.sync(this.state());
    });
    inject(DestroyRef).onDestroy(() => {
      this.session.dispose();
      this.app.scheduler.stopAll();
    });
    void this.session.start();
  }

  update(patch: SettingsPatch): void {
    this.session.update(patch);
  }
}
