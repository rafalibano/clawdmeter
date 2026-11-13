import { activeClaudeAccount, effectiveClaudeClientId } from '../../../domain/settings';
import type { UsageResets } from '../../../domain/usage';
import type { Clock, ConnectionPrefsStore, SettingsStore, UsageResetsGateway } from '../../ports';

export interface UsageResetsData {
  accountId: string;
  at: number;
  resets: UsageResets | null;
}

export class LoadUsageResets {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly settings: Pick<SettingsStore, 'load'>,
    private readonly gateway: UsageResetsGateway,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<UsageResetsData | null> {
    const { usageBlocks, claude } = await this.settings.load();
    if (!usageBlocks.resets) return null;
    if (!(await this.prefs.load()).claude.enabled) return null;
    const account = activeClaudeAccount(claude);
    if (account === null) return null;
    const resets = await this.gateway.fetch(account.id, effectiveClaudeClientId(claude));
    return { accountId: account.id, at: this.clock.now(), resets };
  }
}
