import { CodedError } from '../../../domain/coded-error';
import { ConnectionProblemError } from '../../../domain/connections';
import { buildForecasts, recordSnapshot, retainHistory } from '../../../domain/usage';
import type { UsageForecasts, UsageHistory, UsageSnapshot } from '../../../domain/usage';
import type { Connections } from '../../connections/create-connections';
import type { ImportExternalUsageHistory } from './import-external-usage-history';
import type {
  Clock,
  ConnectionPrefsStore,
  UsageGateway,
  UsageHistoryStore,
  UsageIndicator,
} from '../../ports';

export interface UsageData {
  at: number;
  snapshot: UsageSnapshot;
  history: UsageHistory;
  forecasts: UsageForecasts;
}

export type UsageConnections = Pick<Connections, 'monitor' | 'check' | 'report'>;

export class LoadUsage {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly gateway: UsageGateway,
    private readonly historyStore: UsageHistoryStore,
    private readonly clock: Clock,
    private readonly connections: UsageConnections,
    private readonly indicator: UsageIndicator,
    private readonly external?: ImportExternalUsageHistory,
  ) {}

  async execute(): Promise<UsageData> {
    const now = this.clock.now();
    const snapshot = await this.fetchSnapshot(now);
    this.indicate(snapshot, now);
    const stored = await this.historyStore.load();
    const recorded = recordSnapshot(stored, snapshot, now);
    const merged = (await this.external?.execute(recorded, now)) ?? recorded;
    const history = retainHistory(merged, now);
    await this.historyStore.save(history);
    await this.recoverConnection();
    return { at: now, snapshot, history, forecasts: buildForecasts(history, snapshot, now) };
  }

  private async fetchSnapshot(now: number): Promise<UsageSnapshot> {
    try {
      if (!(await this.prefs.load()).claude.enabled) {
        throw new CodedError('usage-disconnected');
      }
      return await this.gateway.fetch();
    } catch (error) {
      this.indicate(null, now);
      if (error instanceof ConnectionProblemError) {
        this.connections.report.execute('claude', error.problem, error.message === error.problem ? undefined : error.message);
      }
      throw error;
    }
  }

  private indicate(snapshot: UsageSnapshot | null, now: number): void {
    this.indicator.update(snapshot, now).catch(() => undefined);
  }

  private async recoverConnection(): Promise<void> {
    if (this.connections.monitor.get('claude').state === 'error') await this.connections.check.execute('claude');
  }
}
