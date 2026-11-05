import type { PullRequestGroup } from '../../../domain/pull-requests';

export interface GroupedSection {
  id: string;
  groups: readonly PullRequestGroup[];
}

export type OpenMap = ReadonlyMap<string, boolean>;

export function groupStateKey(scope: string, sectionId: string, groupKey: string): string {
  return `${scope}/${sectionId}/${groupKey}`;
}

export function isGroupOpen(map: OpenMap, key: string, group: Pick<PullRequestGroup, 'collapsedByDefault'>): boolean {
  return map.get(key) ?? !group.collapsedByDefault;
}

export function toggleGroup(map: OpenMap, key: string, group: Pick<PullRequestGroup, 'collapsedByDefault'>): OpenMap {
  return new Map(map).set(key, !isGroupOpen(map, key, group));
}

export function allGroupsOpen(map: OpenMap, scope: string, sections: readonly GroupedSection[]): boolean {
  return sections.every((section) =>
    section.groups.every((group) => isGroupOpen(map, groupStateKey(scope, section.id, group.key), group)),
  );
}

export function hasGroups(sections: readonly GroupedSection[]): boolean {
  return sections.some((section) => section.groups.length > 0);
}

export function setAllGroups(map: OpenMap, scope: string, sections: readonly GroupedSection[], open: boolean): OpenMap {
  const next = new Map(map);
  for (const section of sections) {
    for (const group of section.groups) next.set(groupStateKey(scope, section.id, group.key), open);
  }
  return next;
}

export function toggleAllGroups(map: OpenMap, scope: string, sections: readonly GroupedSection[]): OpenMap {
  return setAllGroups(map, scope, sections, !allGroupsOpen(map, scope, sections));
}
