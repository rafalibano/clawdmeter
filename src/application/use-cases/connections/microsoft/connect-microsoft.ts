import type { ConnectionStatus } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import { updatePrefs } from '../../../connections/update-prefs';
import type { ConnectionPrefsStore, MicrosoftAuthorizer } from '../../../ports';

export class ConnectMicrosoft implements StatusUseCase {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly authorizer: MicrosoftAuthorizer,
  ) {}

  async execute(): Promise<ConnectionStatus> {
    const session = await this.authorizer.signIn();
    await updatePrefs(this.prefs, (current) => ({ ...current, microsoft: { account: session.account } }));
    return { state: 'connected', account: session.account };
  }
}
