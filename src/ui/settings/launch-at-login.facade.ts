import { Injectable, computed, inject, signal } from '@angular/core';
import type { LaunchAtLoginState } from '../../application/use-cases';
import { APPLICATION } from '../shell/application.token';

@Injectable()
export class LaunchAtLoginFacade {
  private readonly app = inject(APPLICATION);
  private readonly state = signal<LaunchAtLoginState>({ supported: false, enabled: false, failed: false });
  private readonly loaded = signal(false);
  private readonly pending = signal(false);

  readonly supported = computed(() => this.loaded() && this.state().supported);
  readonly enabled = computed(() => this.state().enabled);
  readonly failed = computed(() => this.state().failed);
  readonly ready = this.loaded.asReadonly();
  readonly busy = computed(() => !this.loaded() || this.pending());

  constructor() {
    this.load().catch(() => undefined);
  }

  async set(enabled: boolean): Promise<void> {
    if (this.busy()) return;
    this.pending.set(true);
    const previous = this.state();
    this.state.set({ ...previous, enabled, failed: false });
    try {
      this.state.set(await this.app.setLaunchAtLogin.execute(enabled));
    } catch {
      this.state.set({ ...previous, failed: 'write' });
    } finally {
      this.pending.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.state.set(await this.app.getLaunchAtLogin.execute());
    } catch {
      this.state.set({ supported: true, enabled: false, failed: 'read' });
    } finally {
      this.loaded.set(true);
    }
  }
}
