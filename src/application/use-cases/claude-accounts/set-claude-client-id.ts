import { CodedError } from '../../../domain/coded-error';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID, normalizeClientId } from '../../../domain/settings';
import type { ClaudeAccountDeps } from './claude-account-deps';

export class SetClaudeClientId {
  constructor(private readonly deps: ClaudeAccountDeps) {}

  async execute(value: string | null): Promise<string> {
    const clientId = value === null ? DEFAULT_CLAUDE_OAUTH_CLIENT_ID : normalizeClientId(value);
    if (clientId === null) throw new CodedError('claude-client-id-invalid');
    await this.deps.updateSettings.execute({ claude: { clientId } });
    return clientId;
  }
}
