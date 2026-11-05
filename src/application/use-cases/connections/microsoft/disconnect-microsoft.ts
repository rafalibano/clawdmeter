import type { ConnectionStatus } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import { updatePrefs } from '../../../connections/update-prefs';
import type { ConnectionPrefsStore, MicrosoftAuthorizer } from '../../../ports';

export class DisconnectMicrosoft implements StatusUseCase {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly authorizer: MicrosoftAuthorizer,
  ) {}

  async execute(): Promise<ConnectionStatus> {
    await this.authorizer.signOut();
    await updatePrefs(this.prefs, (current) => ({ ...current, microsoft: { account: null } }));
    return { state: 'disconnected' };
  }
}
