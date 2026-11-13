import type { UsageResets } from '../../../domain/usage';
import type { Clock, ConnectionPrefsStore, UsageResetsGateway } from '../../ports';

export interface UsageResetsTarget {
  accountId: string;
  clientId: string;
}

export interface UsageResetsData {
  accountId: string;
  at: number;
  resets: UsageResets | null;
}

export class LoadUsageResets {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly gateway: UsageResetsGateway,
    private readonly clock: Clock,
  ) {}

  async execute(target: UsageResetsTarget): Promise<UsageResetsData | null> {
    if (!(await this.prefs.load()).claude.enabled) return null;
    const resets = await this.gateway.fetch(target.accountId, target.clientId);
    return { accountId: target.accountId, at: this.clock.now(), resets };
  }
}
