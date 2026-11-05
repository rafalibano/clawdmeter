import type { ConnectionStatus } from '../../../../domain/connections';
import { updatePrefs } from '../../../connections/update-prefs';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { ConnectionPrefsStore } from '../../../ports';

export class DisconnectClaude implements StatusUseCase {
  constructor(private readonly prefs: ConnectionPrefsStore) {}

  async execute(): Promise<ConnectionStatus> {
    await updatePrefs(this.prefs, (current) => ({ ...current, claude: { enabled: false } }));
    return { state: 'disconnected' };
  }
}
