import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { DeviceCode } from '../../application/ports';
import {
  CONNECTIONS,
  UNKNOWN_STATUS,
  type ConnectionAction,
  type ConnectionId,
  type ConnectionStatus,
} from '../../domain/connections';
import { toRowView, type ConnectionRowView } from '../settings/connections/connection-view';
import { APPLICATION } from './application.token';
import { I18n } from '../i18n/i18n.service';
import { ClaudeAccountsFacade } from './claude-accounts.facade';
import { SettingsFacade } from './settings.facade';
import { CLAUDE_ACCOUNTS_SECTION, ShellNavigation } from './shell-navigation.service';

@Injectable({ providedIn: 'root' })
export class ConnectionsFacade {
  private readonly connections = inject(APPLICATION).connections;
  private readonly registry = inject(APPLICATION).registry;
  private readonly settings = inject(SettingsFacade);
  private readonly i18n = inject(I18n);
  private readonly navigation = inject(ShellNavigation);
  private readonly claudeAccounts = inject(ClaudeAccountsFacade);
  private readonly statuses = signal<ReadonlyMap<ConnectionId, ConnectionStatus>>(new Map());

  readonly listedIds = computed(() => {
    const required = new Set(this.registry.listedConnections(this.settings.settings()));
    return CONNECTIONS.filter((connection) => required.has(connection.id)).map((connection) => connection.id);
  });

  readonly rows = computed<ConnectionRowView[]>(() =>
    this.listedIds().map((id) => toRowView(id, this.statuses().get(id) ?? UNKNOWN_STATUS, this.i18n.localizer())),
  );

  constructor() {
    const stop = this.connections.monitor.subscribe((id, status) =>
      this.statuses.update((current) => new Map(current).set(id, status)),
    );
    inject(DestroyRef).onDestroy(stop);
  }

  refresh(onlyUnknown: boolean): Promise<void> {
    const statuses = this.statuses();
    const ids = this.listedIds().filter((id) => !onlyUnknown || (statuses.get(id) ?? UNKNOWN_STATUS).state === 'unknown');
    return this.connections.checkMany.execute(ids);
  }

  async act(id: ConnectionId, action: ConnectionAction): Promise<void> {
    switch (action.kind) {
      case 'connect':
        await this.connections.connect.execute(id);
        return;
      case 'disconnect':
        await this.connections.disconnect.execute(id);
        return;
      case 'recheck':
        await this.connections.check.execute(id);
        return;
      case 'fix':
        if (this.opensSettings(id, action)) await this.fixInSettings(action);
        else await this.connections.fix.execute(id, action.fix);
        return;
    }
  }

  opensSettings(id: ConnectionId, action: ConnectionAction): boolean {
    return id === 'claude' && action.kind === 'fix' && (action.fix === 'add-claude-account' || action.fix === 'reauthenticate-claude');
  }

  private async fixInSettings(action: ConnectionAction): Promise<void> {
    this.navigation.openSettings(CLAUDE_ACCOUNTS_SECTION);
    if (action.kind === 'fix' && action.fix === 'reauthenticate-claude') void this.claudeAccounts.reauthenticateActive();
  }

  openUrl(url: string): Promise<void> {
    return this.connections.openUrl.execute(url).catch(() => undefined);
  }

  startGitHubDeviceFlow(): Promise<DeviceCode | null> {
    return this.connections.github.startDeviceFlow.execute();
  }

  async completeGitHubDeviceFlow(code: DeviceCode, signal: AbortSignal): Promise<void> {
    await this.connections.github.completeDeviceFlow.execute(code, signal);
  }

  async connectGitHubWithPat(pat: string): Promise<void> {
    await this.connections.github.connectWithPat.execute(pat);
  }
}
