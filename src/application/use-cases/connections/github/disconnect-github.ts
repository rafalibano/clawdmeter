import type { ConnectionStatus } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import { updatePrefs } from '../../../connections/update-prefs';
import { SECRET_KEYS, type ConnectionPrefsStore, type SecretStore } from '../../../ports';

export class DisconnectGitHub implements StatusUseCase {
  constructor(
    private readonly secrets: SecretStore,
    private readonly prefs: ConnectionPrefsStore,
  ) {}

  async execute(): Promise<ConnectionStatus> {
    await this.secrets.delete(SECRET_KEYS.githubToken);
    await updatePrefs(this.prefs, (current) => ({ ...current, github: { method: null } }));
    return { state: 'disconnected' };
  }
}
