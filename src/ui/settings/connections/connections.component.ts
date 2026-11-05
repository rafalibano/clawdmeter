import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import type { DeviceCode } from '../../../application/ports';
import type { ConnectionAction, ConnectionId } from '../../../domain/connections';
import { ConnectionsFacade } from '../../shell/connections.facade';
import type { ConnectionRowView } from './connection-view';

const TONE_ICONS = { ok: '✓', error: '⚠', idle: '○', busy: '…' } as const;

@Component({
  selector: 'dp-connections',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './connections.component.html',
  styleUrl: './connections.component.scss',
})
export class ConnectionsComponent {
  private readonly facade = inject(ConnectionsFacade);

  protected readonly rows = this.facade.rows;
  protected readonly deviceCode = signal<DeviceCode | null>(null);
  protected readonly patOpen = signal(false);
  protected readonly githubStarting = signal(false);
  private deviceFlow: AbortController | null = null;

  constructor() {
    void this.facade.refresh(false);
    effect(() => {
      this.facade.requiredIds();
      untracked(() => void this.facade.refresh(true));
    });
  }

  protected icon(row: ConnectionRowView): string {
    return TONE_ICONS[row.tone];
  }

  protected run(id: ConnectionId, action: ConnectionAction): void {
    this.cancelDeviceFlow();
    this.deviceCode.set(null);
    this.patOpen.set(false);
    void this.facade.act(id, action);
  }

  protected async startDeviceFlow(): Promise<void> {
    const flow = new AbortController();
    this.deviceFlow = flow;
    this.githubStarting.set(true);
    this.patOpen.set(false);
    try {
      const code = await this.facade.startGitHubDeviceFlow();
      if (code === null || flow.signal.aborted) return;
      this.deviceCode.set(code);
      await this.facade.completeGitHubDeviceFlow(code, flow.signal);
    } finally {
      if (this.deviceFlow === flow) {
        this.deviceFlow = null;
        this.deviceCode.set(null);
        this.githubStarting.set(false);
      }
    }
  }

  protected cancelDeviceFlow(): void {
    this.deviceFlow?.abort();
    this.deviceFlow = null;
    this.deviceCode.set(null);
    this.githubStarting.set(false);
  }

  protected openPat(): void {
    this.cancelDeviceFlow();
    this.deviceCode.set(null);
    this.patOpen.update((open) => !open);
  }

  protected async submitPat(value: string): Promise<void> {
    await this.facade.connectGitHubWithPat(value);
    this.patOpen.set(false);
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
