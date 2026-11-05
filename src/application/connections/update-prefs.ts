import type { ConnectionPrefs } from '../../domain/connections';
import type { ConnectionPrefsStore } from '../ports';

export async function updatePrefs(
  store: ConnectionPrefsStore,
  change: (prefs: ConnectionPrefs) => ConnectionPrefs,
): Promise<ConnectionPrefs> {
  const next = change(await store.load());
  await store.save(next);
  return next;
}
