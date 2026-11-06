import { CodedError } from '../../../domain/coded-error';
import { DEFAULT_CLAUDE_OAUTH_CLIENT_ID, normalizeClientId } from '../../../domain/settings';
import type { ClaudeAccountDeps } from './claude-account-deps';

export type ClaudeClientIdChoice = { useDefault: true } | { useDefault: false; clientId: string };

export class SetClaudeClientIdMode {
  constructor(private readonly deps: ClaudeAccountDeps) {}

  async execute(choice: ClaudeClientIdChoice): Promise<string> {
    if (choice.useDefault) {
      await this.deps.updateSettings.execute({ claude: { useDefaultClientId: true } });
      return DEFAULT_CLAUDE_OAUTH_CLIENT_ID;
    }
    const clientId = normalizeClientId(choice.clientId);
    if (clientId === null) throw new CodedError('claude-client-id-invalid');
    await this.deps.updateSettings.execute({ claude: { useDefaultClientId: false, clientId } });
    return clientId;
  }
}
