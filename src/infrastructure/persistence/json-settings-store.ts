import {
  SettingsWriteBlockedError,
  type SettingsFileStatus,
  type SettingsStore,
  type Unsubscribe,
} from '../../application/ports';
import {
  createDefaultSettings,
  isFutureSchema,
  migrateSettings,
  SCHEMA_VERSION,
  type AppSettings,
} from '../../domain/settings';
import type { JsonFile } from './json-file';

const ECHO_WINDOW_MS = 1_000;

export interface JsonSettingsStoreOptions {
  echoWindowMs?: number;
  now?: () => number;
}

export class JsonSettingsStore implements SettingsStore {
  private readonly echoWindowMs: number;
  private readonly now: () => number;
  private readonly recentWrites = new Map<string, number>();
  private inFlight = 0;
  private lastValid: AppSettings | null = null;
  private fileStatus: SettingsFileStatus = 'ok';

  constructor(
    private readonly file: JsonFile,
    options: JsonSettingsStoreOptions = {},
  ) {
    this.echoWindowMs = options.echoWindowMs ?? ECHO_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  status(): SettingsFileStatus {
    return this.fileStatus;
  }

  async load(): Promise<AppSettings> {
    const text = await this.file.read();
    if (text === null) return this.write(createDefaultSettings());
    const raw = this.parse(text);
    if (raw === undefined) {
      this.fileStatus = 'invalid';
      return this.lastValid ?? this.remember(createDefaultSettings());
    }
    this.fileStatus = this.statusOf(raw);
    const settings = this.remember(migrateSettings(raw));
    if (this.isOutdated(raw)) await this.write(settings);
    return settings;
  }

  async save(settings: AppSettings): Promise<void> {
    this.remember(settings);
    const text = await this.file.read();
    if (text !== null) {
      const raw = this.parse(text);
      this.fileStatus = raw === undefined ? 'invalid' : this.statusOf(raw);
      if (this.fileStatus !== 'ok') throw new SettingsWriteBlockedError(this.fileStatus);
    }
    await this.write(settings);
  }

  watch(listener: (settings: AppSettings) => void): Promise<Unsubscribe> {
    return this.file.watch(async () => {
      if (this.inFlight > 0) return;
      const text = await this.file.read();
      if (text === null || this.isEcho(text)) return;
      const raw = this.parse(text);
      if (raw === undefined) {
        this.fileStatus = 'invalid';
        return;
      }
      this.fileStatus = this.statusOf(raw);
      listener(this.remember(migrateSettings(raw)));
    });
  }

  private async write(settings: AppSettings): Promise<AppSettings> {
    const text = `${JSON.stringify(settings, null, 2)}\n`;
    this.pruneExpired();
    this.recentWrites.set(text, this.now() + this.echoWindowMs);
    this.inFlight++;
    try {
      await this.file.write(text);
    } finally {
      this.inFlight--;
      this.recentWrites.set(text, this.now() + this.echoWindowMs);
    }
    this.fileStatus = 'ok';
    return this.remember(settings);
  }

  private remember(settings: AppSettings): AppSettings {
    this.lastValid = settings;
    return settings;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [written, expiresAt] of this.recentWrites) {
      if (expiresAt <= now) this.recentWrites.delete(written);
    }
  }

  private isEcho(text: string): boolean {
    this.pruneExpired();
    return this.recentWrites.has(text);
  }

  private statusOf(raw: Record<string, unknown>): SettingsFileStatus {
    return isFutureSchema(raw) ? 'future' : 'ok';
  }

  private parse(text: string): Record<string, unknown> | undefined {
    try {
      const value: unknown = JSON.parse(text);
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private isOutdated(raw: Record<string, unknown>): boolean {
    const version = raw['schemaVersion'];
    return typeof version !== 'number' || version < SCHEMA_VERSION;
  }
}
