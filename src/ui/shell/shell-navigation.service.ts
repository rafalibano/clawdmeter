import { Injectable, signal } from '@angular/core';

export const CLAUDE_ACCOUNTS_SECTION = 'claude-accounts';

@Injectable({ providedIn: 'root' })
export class ShellNavigation {
  private readonly open = signal(false);
  private readonly requested = signal<string | null>(null);

  readonly settingsOpen = this.open.asReadonly();
  readonly requestedSection = this.requested.asReadonly();

  openSettings(section: string | null = null): void {
    this.requested.set(section);
    this.open.set(true);
  }

  closeSettings(): void {
    this.open.set(false);
    this.requested.set(null);
  }

  toggleSettings(): void {
    if (this.open()) this.closeSettings();
    else this.openSettings();
  }

  consume(section: string): void {
    if (this.requested() === section) this.requested.set(null);
  }
}
