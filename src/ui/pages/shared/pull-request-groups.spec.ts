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

describe('estado dos grupos de repo', () => {
  it('sem escolha, grupos abrem e o Deploy vem recolhido', () => {
    const map: OpenMap = new Map();
    expect(isGroupOpen(map, key('to-review', 'acme/api'), group('acme/api'))).toBe(true);
    expect(isGroupOpen(map, key('to-review', '@deploy'), group('@deploy', true))).toBe(false);
  });

  it('o clique individual alterna só aquele grupo', () => {
    const afterClick = toggleGroup(new Map(), key('to-review', 'acme/api'), group('acme/api'));
    expect(isGroupOpen(afterClick, key('to-review', 'acme/api'), group('acme/api'))).toBe(false);
    expect(isGroupOpen(afterClick, key('to-review', 'acme/web'), group('acme/web'))).toBe(true);
    const reopened = toggleGroup(afterClick, key('to-review', 'acme/api'), group('acme/api'));
    expect(isGroupOpen(reopened, key('to-review', 'acme/api'), group('acme/api'))).toBe(true);
  });

  it('"Recolher tudo" fecha todos, inclusive o Deploy já fechado, em todas as seções', () => {
    const collapsed = setAllGroups(new Map(), 'reviews', SECTIONS, false);
    for (const section of SECTIONS) {
      for (const item of section.groups) expect(isGroupOpen(collapsed, key(section.id, item.key), item)).toBe(false);
    }
    expect(allGroupsOpen(collapsed, 'reviews', SECTIONS)).toBe(false);
  });

  it('"Expandir tudo" abre todos, inclusive o Deploy', () => {
    const expanded = setAllGroups(new Map(), 'reviews', SECTIONS, true);
    expect(isGroupOpen(expanded, key('to-review', '@deploy'), group('@deploy', true))).toBe(true);
    expect(allGroupsOpen(expanded, 'reviews', SECTIONS)).toBe(true);
  });

  it('o controle alterna conforme o estado: com o Deploy fechado por padrão ele oferece expandir', () => {
    const initial: OpenMap = new Map();
    expect(allGroupsOpen(initial, 'reviews', SECTIONS)).toBe(false);
    const expanded = toggleAllGroups(initial, 'reviews', SECTIONS);
    expect(allGroupsOpen(expanded, 'reviews', SECTIONS)).toBe(true);
    const collapsed = toggleAllGroups(expanded, 'reviews', SECTIONS);
    expect(allGroupsOpen(collapsed, 'reviews', SECTIONS)).toBe(false);
  });

  it('depois de recolher tudo, o clique individual reabre um grupo e o controle segue oferecendo expandir', () => {
    const collapsed = setAllGroups(new Map(), 'reviews', SECTIONS, false);
    const one = toggleGroup(collapsed, key('to-review', 'acme/api'), group('acme/api'));
    expect(isGroupOpen(one, key('to-review', 'acme/api'), group('acme/api'))).toBe(true);
    expect(allGroupsOpen(one, 'reviews', SECTIONS)).toBe(false);
  });

  it('o estado de PRs e o de Reviews não se misturam', () => {
    const reviews = setAllGroups(new Map(), 'reviews', SECTIONS, false);
    expect(allGroupsOpen(reviews, 'prs', SECTIONS)).toBe(false);
    expect(isGroupOpen(reviews, groupStateKey('prs', 'to-review', 'acme/api'), group('acme/api'))).toBe(true);
  });

  it('o estado é imutável e sobrevive a uma nova carga com os mesmos grupos', () => {
    const base: OpenMap = new Map();
    const next = setAllGroups(base, 'reviews', SECTIONS, false);
    expect(base.size).toBe(0);
    expect(next.size).toBe(4);
    expect(allGroupsOpen(next, 'reviews', JSON.parse(JSON.stringify(SECTIONS)))).toBe(false);
  });

  it('sem nenhum grupo o controle não aparece', () => {
    expect(hasGroups([{ id: 'mine', groups: [] }])).toBe(false);
    expect(hasGroups(SECTIONS)).toBe(true);
    expect(allGroupsOpen(new Map(), 'prs', [])).toBe(true);
  });
});
