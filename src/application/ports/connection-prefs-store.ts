import type { ConnectionPrefs } from '../../domain/connections';

export interface ConnectionPrefsStore {
  load(): Promise<ConnectionPrefs>;
  save(prefs: ConnectionPrefs): Promise<void>;
}
