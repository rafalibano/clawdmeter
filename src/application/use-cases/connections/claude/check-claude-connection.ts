import { errorStatus, type ConnectionStatus } from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { ClaudeCredentialSource, Clock, ConnectionPrefsStore } from '../../../ports';

export class CheckClaudeConnection implements StatusUseCase {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly credentials: ClaudeCredentialSource,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<ConnectionStatus> {
    if (!(await this.prefs.load()).claude.enabled) return { state: 'disconnected' };
    const credential = await this.credentials.read();
    if (credential.expiresAt !== null && credential.expiresAt <= this.clock.now()) {
      return errorStatus('claude-expired');
    }
    return credential.subscriptionType === null
      ? { state: 'connected' }
      : { state: 'connected', detail: `Plano ${credential.subscriptionType}` };
  }
}
