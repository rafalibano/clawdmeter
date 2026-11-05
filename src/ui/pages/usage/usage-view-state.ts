import { Injectable, signal } from '@angular/core';
import { DEFAULT_USAGE_RANGE } from '../../../domain/usage';

@Injectable({ providedIn: 'root' })
export class UsageViewState {
  readonly range = signal(DEFAULT_USAGE_RANGE);
}
