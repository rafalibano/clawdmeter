import { Injectable, signal } from '@angular/core';
import type { PullRequestGroup } from '../../../domain/pull-requests';
import {
  allGroupsOpen,
  groupStateKey,
  isGroupOpen,
  toggleAllGroups,
  toggleGroup,
  type GroupedSection,
  type OpenMap,
} from './pull-request-groups';

@Injectable({ providedIn: 'root' })
export class PullRequestGroupsState {
  private readonly open = signal<OpenMap>(new Map());

  isOpen(scope: string, sectionId: string, group: PullRequestGroup): boolean {
    return isGroupOpen(this.open(), groupStateKey(scope, sectionId, group.key), group);
  }

  toggle(scope: string, sectionId: string, group: PullRequestGroup): void {
    this.open.update((map) => toggleGroup(map, groupStateKey(scope, sectionId, group.key), group));
  }

  allOpen(scope: string, sections: readonly GroupedSection[]): boolean {
    return allGroupsOpen(this.open(), scope, sections);
  }

  toggleAll(scope: string, sections: readonly GroupedSection[]): void {
    this.open.update((map) => toggleAllGroups(map, scope, sections));
  }
}
