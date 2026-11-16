import type { UsageResetsGateway } from '../../application/ports';
import { RateLimitedError, isBackoffMessage } from '../../domain/rate-limit';
import { parseUsageResets, type UsageResets } from '../../domain/usage';
import { PlatformCommandError, type TauriCommands } from '../platform/tauri-commands';

export class AnthropicUsageResetsGateway implements UsageResetsGateway {
  constructor(private readonly commands: TauriCommands) {}

  async fetch(accountId: string, clientId: string): Promise<UsageResets | null> {
    try {
      return parseUsageResets(await this.commands.call<unknown>('claude_usage_resets_fetch', { accountId, clientId }));
    } catch (error) {
      if (error instanceof PlatformCommandError && isBackoffMessage(error.message)) throw new RateLimitedError();
      throw error;
    }
  }
}
