import type { UsageGateway } from '../../application/ports';
import { RateLimitedError, isBackoffMessage } from '../../domain/rate-limit';
import { parseUsageResponse, type UsageSnapshot } from '../../domain/usage';
import { PlatformCommandError, type TauriCommands } from '../platform/tauri-commands';

export class AnthropicUsageGateway implements UsageGateway {
  constructor(private readonly commands: TauriCommands) {}

  async fetch(): Promise<UsageSnapshot> {
    try {
      return parseUsageResponse(await this.commands.call<unknown>('claude_usage_fetch'));
    } catch (error) {
      if (error instanceof PlatformCommandError && isBackoffMessage(error.message)) throw new RateLimitedError();
      throw error;
    }
  }
}
