import { CodedError } from '../../../domain/coded-error';
import { ConnectionProblemError, claudeSignInRequired, customMessage } from '../../../domain/connections';
import { activeClaudeAccount, type ClaudeAccount } from '../../../domain/settings';
import { recordSnapshot, retainHistory } from '../../../domain/usage';
import type { UsageHistory, UsageSnapshot } from '../../../domain/usage';
import type { Connections } from '../../connections/create-connections';
import type { ImportExternalUsageHistory } from './import-external-usage-history';
import type { NotifyUsageQuartiles } from './notify-usage-quartiles';
import type {
  Clock,
  ConnectionPrefsStore,
  SettingsStore,
  UsageGateway,
  UsageHistoryStore,
  UsageHistoryStores,
  UsageIndicator,
} from '../../ports';

export interface UsageData {
  accountId: string;
  at: number;
  snapshot: UsageSnapshot;
  history: UsageHistory;
}

export type UsageConnections = Pick<Connections, 'monitor' | 'check' | 'report'>;

export class LoadUsage {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly settings: Pick<SettingsStore, 'load'>,
    private readonly gateway: UsageGateway,
    private readonly histories: UsageHistoryStores,
    private readonly clock: Clock,
    private readonly connections: UsageConnections,
    private readonly indicator: UsageIndicator,
    private readonly external?: ImportExternalUsageHistory,
    private readonly alerts?: NotifyUsageQuartiles,
  ) {}

  async execute(): Promise<UsageData> {
    const now = this.clock.now();
    const { account, snapshot } = await this.fetchSnapshot(now);
    this.indicate(snapshot, now);
    this.alerts?.execute(account.id, snapshot).catch(() => undefined);
    const store = this.histories.forAccount(account.id);
    const stored = await store.load();
    const recorded = recordSnapshot(stored, snapshot, now);
    const imported = await this.migrateExternal(store, recorded, now);
    const history = retainHistory(imported.history, now);
    await store.save(history);
    if (imported.markAt !== null) await store.markImported(imported.markAt);
    await this.recoverConnection();
    return { accountId: account.id, at: now, snapshot, history };
  }

  private async migrateExternal(
    store: UsageHistoryStore,
    history: UsageHistory,
    now: number,
  ): Promise<{ history: UsageHistory; markAt: number | null }> {
    if (this.external === undefined) return { history, markAt: null };
    const previous = await store.importedAt();
    const outcome = await this.external.execute(history, previous, now);
    return { history: outcome.history, markAt: previous === null ? outcome.importedAt : null };
  }

  private async fetchSnapshot(now: number): Promise<{ account: ClaudeAccount; snapshot: UsageSnapshot }> {
    try {
      if (!(await this.prefs.load()).claude.enabled) {
        throw new CodedError('usage-disconnected');
      }
      const { claude } = await this.settings.load();
      const account = activeClaudeAccount(claude);
      if (account === null) throw new ConnectionProblemError('claude-no-account');
      return { account, snapshot: await this.fetchFor(account, claude.clientId) };
    } catch (error) {
      this.indicate(null, now);
      if (error instanceof ConnectionProblemError) {
        this.connections.report.execute('claude', error.problem, customMessage(error), error.code, error.args);
      }
      throw error;
    }
  }

  private async fetchFor(account: ClaudeAccount, clientId: string): Promise<UsageSnapshot> {
    try {
      return await this.gateway.fetch(account.id, clientId);
    } catch (error) {
      if (error instanceof ConnectionProblemError && error.problem === 'claude-signin-required') {
        throw claudeSignInRequired(account.name);
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
