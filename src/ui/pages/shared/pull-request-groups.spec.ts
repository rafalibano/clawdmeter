import { describe, expect, it } from 'vitest';
import type { PullRequestGroup } from '../../../domain/pull-requests';
import {
  allGroupsOpen,
  groupStateKey,
  hasGroups,
  isGroupOpen,
  setAllGroups,
  toggleAllGroups,
  toggleGroup,
  type GroupedSection,
  type OpenMap,
} from './pull-request-groups';

const group = (key: string, collapsedByDefault = false): PullRequestGroup => ({ key, title: key, collapsedByDefault, items: [] });

const SECTIONS: GroupedSection[] = [
  { id: 'to-review', groups: [group('acme/api'), group('acme/web'), group('@deploy', true)] },
  { id: 'reviewed', groups: [group('acme/api')] },
];

const key = (section: string, groupKey: string) => groupStateKey('reviews', section, groupKey);

describe('repo group state', () => {
  it('without a choice, groups open and Deploy comes collapsed', () => {
    const map: OpenMap = new Map();
    expect(isGroupOpen(map, key('to-review', 'acme/api'), group('acme/api'))).toBe(true);
    expect(isGroupOpen(map, key('to-review', '@deploy'), group('@deploy', true))).toBe(false);
  });

  it('a single click toggles only that group', () => {
    const afterClick = toggleGroup(new Map(), key('to-review', 'acme/api'), group('acme/api'));
    expect(isGroupOpen(afterClick, key('to-review', 'acme/api'), group('acme/api'))).toBe(false);
    expect(isGroupOpen(afterClick, key('to-review', 'acme/web'), group('acme/web'))).toBe(true);
    const reopened = toggleGroup(afterClick, key('to-review', 'acme/api'), group('acme/api'));
    expect(isGroupOpen(reopened, key('to-review', 'acme/api'), group('acme/api'))).toBe(true);
  });

  it('"Collapse all" closes every group, including the already closed Deploy, in all sections', () => {
    const collapsed = setAllGroups(new Map(), 'reviews', SECTIONS, false);
    for (const section of SECTIONS) {
      for (const item of section.groups) expect(isGroupOpen(collapsed, key(section.id, item.key), item)).toBe(false);
    }
    expect(allGroupsOpen(collapsed, 'reviews', SECTIONS)).toBe(false);
  });

  it('"Expand all" opens every group, including Deploy', () => {
    const expanded = setAllGroups(new Map(), 'reviews', SECTIONS, true);
    expect(isGroupOpen(expanded, key('to-review', '@deploy'), group('@deploy', true))).toBe(true);
    expect(allGroupsOpen(expanded, 'reviews', SECTIONS)).toBe(true);
  });

  it('the control toggles according to the state: with Deploy closed by default it offers to expand', () => {
    const initial: OpenMap = new Map();
    expect(allGroupsOpen(initial, 'reviews', SECTIONS)).toBe(false);
    const expanded = toggleAllGroups(initial, 'reviews', SECTIONS);
    expect(allGroupsOpen(expanded, 'reviews', SECTIONS)).toBe(true);
    const collapsed = toggleAllGroups(expanded, 'reviews', SECTIONS);
    expect(allGroupsOpen(collapsed, 'reviews', SECTIONS)).toBe(false);
  });

  it('after collapsing all, a single click reopens a group and the control keeps offering to expand', () => {
    const collapsed = setAllGroups(new Map(), 'reviews', SECTIONS, false);
    const one = toggleGroup(collapsed, key('to-review', 'acme/api'), group('acme/api'));
    expect(isGroupOpen(one, key('to-review', 'acme/api'), group('acme/api'))).toBe(true);
    expect(allGroupsOpen(one, 'reviews', SECTIONS)).toBe(false);
  });

  it('the PRs state and the Reviews state do not mix', () => {
    const reviews = setAllGroups(new Map(), 'reviews', SECTIONS, false);
    expect(allGroupsOpen(reviews, 'prs', SECTIONS)).toBe(false);
    expect(isGroupOpen(reviews, groupStateKey('prs', 'to-review', 'acme/api'), group('acme/api'))).toBe(true);
  });

  it('the state is immutable and survives a new load with the same groups', () => {
    const base: OpenMap = new Map();
    const next = setAllGroups(base, 'reviews', SECTIONS, false);
    expect(base.size).toBe(0);
    expect(next.size).toBe(4);
    expect(allGroupsOpen(next, 'reviews', JSON.parse(JSON.stringify(SECTIONS)))).toBe(false);
  });

  it('with no groups the control does not appear', () => {
    expect(hasGroups([{ id: 'mine', groups: [] }])).toBe(false);
    expect(hasGroups(SECTIONS)).toBe(true);
    expect(allGroupsOpen(new Map(), 'prs', [])).toBe(true);
  });
});
