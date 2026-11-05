import type { SettingsStore, Unsubscribe } from '../../application/ports';
import { createDefaultSettings, migrateSettings, SCHEMA_VERSION, type AppSettings } from '../../domain/settings';
import type { JsonFile } from './json-file';

export class JsonSettingsStore implements SettingsStore {
  private lastWritten: string | null = null;

  constructor(private readonly file: JsonFile) {}

  async load(): Promise<AppSettings> {
    const text = await this.file.read();
    const raw = this.parse(text);
    const settings = raw === undefined ? createDefaultSettings() : migrateSettings(raw);
    if (text === null || this.needsRewrite(raw)) await this.save(settings);
    return settings;
  }

  async save(settings: AppSettings): Promise<void> {
    const text = `${JSON.stringify(settings, null, 2)}\n`;
    this.lastWritten = text;
    await this.file.write(text);
  }

  watch(listener: (settings: AppSettings) => void): Promise<Unsubscribe> {
    return this.file.watch(async () => {
      const text = await this.file.read();
      if (text === null || text === this.lastWritten) return;
      const raw = this.parse(text);
      if (raw === undefined) return;
      listener(migrateSettings(raw));
    });
  }

  private parse(text: string | null): unknown {
    if (text === null) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private needsRewrite(raw: unknown): boolean {
    if (raw === undefined) return true;
    const version = typeof raw === 'object' && raw !== null ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
    return version !== SCHEMA_VERSION;
  }
}
