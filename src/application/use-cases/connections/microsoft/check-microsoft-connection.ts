import type { ConnectionStatus } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { ConnectionPrefsStore, MicrosoftAuthorizer } from '../../../ports';

export class CheckMicrosoftConnection implements StatusUseCase {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly authorizer: MicrosoftAuthorizer,
  ) {}

  async execute(): Promise<ConnectionStatus> {
    const { account } = (await this.prefs.load()).microsoft;
    if (account === null) return { state: 'disconnected' };
    await this.authorizer.accessToken();
    return { state: 'connected', account };
  }
}
