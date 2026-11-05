import {
  applyPatch,
  createDefaultSettings,
  mergePatches,
  type AppSettings,
  type SettingsPatch,
} from '../../domain/settings';
import type { Unsubscribe } from '../ports';
import type { GetSettings, UpdateSettings, WatchSettings } from '../use-cases';

export type SettingsSessionError = 'load' | 'save' | 'watch';

export interface SettingsSessionState {
  settings: AppSettings;
  ready: boolean;
  error: SettingsSessionError | null;
}

export interface SettingsSessionDeps {
  getSettings: Pick<GetSettings, 'execute'>;
  updateSettings: Pick<UpdateSettings, 'execute'>;
  watchSettings: Pick<WatchSettings, 'execute'>;
}

export class SettingsSession {
  private state: SettingsSessionState = { settings: createDefaultSettings(), ready: false, error: null };
  private pending: SettingsPatch[] = [];
  private flushing: Promise<void> | null = null;
  private stopWatching: Unsubscribe | null = null;
  private disposed = false;

  constructor(
    private readonly deps: SettingsSessionDeps,
    private readonly onChange: (state: SettingsSessionState) => void,
  ) {}

  get current(): SettingsSessionState {
    return this.state;
  }

  async start(): Promise<void> {
    try {
      this.emit({ settings: await this.deps.getSettings.execute(), ready: true, error: null });
    } catch {
      this.emit({ settings: createDefaultSettings(), ready: true, error: 'load' });
    }
    try {
      const stop = await this.deps.watchSettings.execute((settings) => this.receive(settings));
      if (this.disposed) stop();
      else this.stopWatching = stop;
    } catch {
      this.emit({ ...this.state, error: this.state.error ?? 'watch' });
    }
  }

  update(patch: SettingsPatch): void {
    this.pending.push(patch);
    this.emit({ ...this.state, settings: applyPatch(this.state.settings, patch) });
    this.flushing ??= this.flush();
  }

  idle(): Promise<void> {
    return this.flushing ?? Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.stopWatching?.();
    this.stopWatching = null;
  }

  private receive(settings: AppSettings): void {
    if (this.flushing) return;
    this.emit({ ...this.state, settings });
  }

  private async flush(): Promise<void> {
    let saved: AppSettings | null = null;
    let failed = false;
    try {
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0).reduce(mergePatches);
        try {
          saved = await this.deps.updateSettings.execute(batch);
        } catch {
          failed = true;
        }
      }
    } finally {
      this.flushing = null;
    }
    if (failed) this.emit({ ...this.state, error: 'save' });
    else if (saved) this.emit({ ...this.state, settings: saved, error: null });
  }

  private emit(state: SettingsSessionState): void {
    this.state = state;
    this.onChange(state);
  }
}
