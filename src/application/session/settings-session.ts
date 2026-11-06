import {
  applyPatch,
  createDefaultSettings,
  mergePatches,
  type AppSettings,
  type SettingsPatch,
} from '../../domain/settings';
import { SettingsWriteBlockedError, type Unsubscribe } from '../ports';
import type { GetSettings, GetSettingsStatus, UpdateSettings, WatchSettings } from '../use-cases';

export type SettingsSessionError = 'load' | 'save' | 'watch' | 'invalid' | 'future';

export interface SettingsSessionState {
  settings: AppSettings;
  ready: boolean;
  error: SettingsSessionError | null;
}

export interface SettingsSessionDeps {
  getSettings: Pick<GetSettings, 'execute'>;
  getSettingsStatus: Pick<GetSettingsStatus, 'execute'>;
  updateSettings: Pick<UpdateSettings, 'execute' | 'subscribe'>;
  watchSettings: Pick<WatchSettings, 'execute'>;
}

export class SettingsSession {
  private state: SettingsSessionState = { settings: createDefaultSettings(), ready: false, error: null };
  private pending: SettingsPatch[] = [];
  private flushing: Promise<void> | null = null;
  private stopWatching: Unsubscribe | null = null;
  private stopSaved: Unsubscribe | null = null;
  private disposed = false;

  constructor(
    private readonly deps: SettingsSessionDeps,
    private readonly onChange: (state: SettingsSessionState) => void,
  ) {}

  get current(): SettingsSessionState {
    return this.state;
  }

  async start(): Promise<void> {
    this.stopSaved ??= this.deps.updateSettings.subscribe((saved) => this.adoptClaude(saved));
    try {
      const settings = await this.deps.getSettings.execute();
      this.emit({ settings, ready: true, error: this.blockedError() });
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
    this.stopSaved?.();
    this.stopSaved = null;
  }

  private adoptClaude(saved: AppSettings): void {
    if (this.disposed || JSON.stringify(saved.claude) === JSON.stringify(this.state.settings.claude)) return;
    this.emit({ ...this.state, settings: { ...this.state.settings, claude: saved.claude } });
  }

  private receive(settings: AppSettings): void {
    if (this.flushing) return;
    const blocked = this.blockedError();
    const error = this.state.error === 'invalid' || this.state.error === 'future' ? blocked : this.state.error;
    this.emit({ ...this.state, settings, error });
  }

  private blockedError(): SettingsSessionError | null {
    const status = this.deps.getSettingsStatus.execute();
    return status === 'ok' ? null : status;
  }

  private async flush(): Promise<void> {
    let saved: AppSettings | null = null;
    let failure: SettingsSessionError | null = null;
    try {
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0).reduce(mergePatches);
        try {
          saved = await this.deps.updateSettings.execute(batch);
        } catch (error) {
          failure = error instanceof SettingsWriteBlockedError ? error.reason : 'save';
        }
      }
    } finally {
      this.flushing = null;
    }
    if (failure) this.emit({ ...this.state, error: failure });
    else if (saved) this.emit({ ...this.state, settings: saved, error: this.state.error === 'save' ? null : this.state.error });
  }

  private emit(state: SettingsSessionState): void {
    this.state = state;
    this.onChange(state);
  }
}
