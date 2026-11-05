import type { ConnectionPrefsStore } from '../../application/ports';
import { createDefaultConnectionPrefs, parseConnectionPrefs, type ConnectionPrefs } from '../../domain/connections';
import type { JsonFile } from './json-file';

export class JsonConnectionPrefsStore implements ConnectionPrefsStore {
  constructor(private readonly file: JsonFile) {}

  async load(): Promise<ConnectionPrefs> {
    const text = await this.file.read();
    if (text === null) return createDefaultConnectionPrefs();
    try {
      return parseConnectionPrefs(JSON.parse(text));
    } catch {
      return createDefaultConnectionPrefs();
    }
  }

  async save(prefs: ConnectionPrefs): Promise<void> {
    await this.file.write(`${JSON.stringify(prefs, null, 2)}\n`);
  }
}
