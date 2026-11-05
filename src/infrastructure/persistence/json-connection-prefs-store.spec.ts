import { describe, expect, it } from 'vitest';
import { createDefaultConnectionPrefs } from '../../domain/connections';
import type { JsonFile } from './json-file';
import { JsonConnectionPrefsStore } from './json-connection-prefs-store';

class MemoryFile implements JsonFile {
  constructor(public text: string | null = null) {}

  async read(): Promise<string | null> {
    return this.text;
  }

  async write(text: string): Promise<void> {
    this.text = text;
  }

  async watch(): Promise<() => void> {
    return () => undefined;
  }
}

describe('JsonConnectionPrefsStore', () => {
  it('a missing or corrupt file uses the defaults without writing', async () => {
    const missing = new MemoryFile();
    expect(await new JsonConnectionPrefsStore(missing).load()).toEqual(createDefaultConnectionPrefs());
    expect(missing.text).toBeNull();
    expect(await new JsonConnectionPrefsStore(new MemoryFile('{quebrado')).load()).toEqual(
      createDefaultConnectionPrefs(),
    );
  });

  it('writes and rereads the preferences', async () => {
    const file = new MemoryFile();
    const store = new JsonConnectionPrefsStore(file);
    const prefs = { claude: { enabled: false }, github: { method: 'pat' as const }, microsoft: { account: 'a@b.c' } };
    await store.save(prefs);
    expect(await store.load()).toEqual(prefs);
  });

  it('never writes secrets: only the authentication method', async () => {
    const file = new MemoryFile();
    await new JsonConnectionPrefsStore(file).save({
      claude: { enabled: true },
      github: { method: 'device-flow' },
      microsoft: { account: null },
    });
    expect(file.text).not.toMatch(/token/i);
  });
});
