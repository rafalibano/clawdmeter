import { describe, expect, it } from 'vitest';
import { allOpen, pruneKeys, toggleAllKeys, toggleKey } from './session-expansion';

describe('session expansion', () => {
  it('toggle opens a closed session and closes an open one', () => {
    const opened = toggleKey(new Set(), '1');
    expect([...opened]).toEqual(['1']);
    expect([...toggleKey(opened, '1')]).toEqual([]);
  });

  it('expand all opens every expandable session and, when all are open, closes them', () => {
    const all = toggleAllKeys(new Set(['1']), ['1', '2']);
    expect([...all].sort()).toEqual(['1', '2']);
    expect(allOpen(all, ['1', '2'])).toBe(true);
    expect([...toggleAllKeys(all, ['1', '2'])]).toEqual([]);
  });

  it('a session that appears after expand all is closed, so expand all opens the rest instead of collapsing', () => {
    const all = toggleAllKeys(new Set(), ['1', '2']);
    expect(allOpen(all, ['1', '2', '3'])).toBe(false);
    expect([...toggleAllKeys(all, ['1', '2', '3'])].sort()).toEqual(['1', '2', '3']);
  });

  it('expand and collapse all only touch the given sessions, so ones hidden by the filter keep their state', () => {
    const open = new Set(['hidden']);
    const expanded = toggleAllKeys(open, ['1', '2']);
    expect([...expanded].sort()).toEqual(['1', '2', 'hidden']);
    expect([...toggleAllKeys(expanded, ['1', '2'])]).toEqual(['hidden']);
  });

  it('with no expandable session nothing counts as all open', () => {
    expect(allOpen(new Set(['1']), [])).toBe(false);
  });

  it('prune drops sessions that are gone, so a reused pid does not come back open', () => {
    const open = new Set(['1', '2']);
    const pruned = pruneKeys(open, ['2', '3']);
    expect([...pruned]).toEqual(['2']);
    expect(pruneKeys(pruned, ['2', '3', '1']).has('1')).toBe(false);
  });

  it('prune keeps the same set when nothing is gone', () => {
    const open = new Set(['1']);
    expect(pruneKeys(open, ['1', '2'])).toBe(open);
  });

  it('prune by every listed session keeps a dropdown open while its usage is momentarily missing', () => {
    const open = new Set(['1', '2']);
    const expandable = ['2'];
    expect(allOpen(open, expandable)).toBe(true);
    expect(pruneKeys(open, ['1', '2'])).toBe(open);
  });
});
