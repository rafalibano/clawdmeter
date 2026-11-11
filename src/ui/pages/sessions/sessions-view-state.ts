import { Injectable, signal } from '@angular/core';
import type { SessionsFilter } from './sessions-view';

@Injectable({ providedIn: 'root' })
export class SessionsViewState {
  readonly filter = signal<SessionsFilter>('all');
  readonly expanded = signal<ReadonlySet<string>>(new Set());
}
