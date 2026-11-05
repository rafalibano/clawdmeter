import type { UsageGateway } from '../../application/ports';
import { parseUsageResponse, type UsageSnapshot } from '../../domain/usage';
import type { TauriCommands } from '../platform/tauri-commands';

export class AnthropicUsageGateway implements UsageGateway {
  constructor(private readonly commands: TauriCommands) {}

  async fetch(): Promise<UsageSnapshot> {
    return parseUsageResponse(await this.commands.call<unknown>('claude_usage_fetch'));
  }
}
