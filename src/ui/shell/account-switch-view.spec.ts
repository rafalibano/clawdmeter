import { describe, expect, it } from 'vitest';
import { createDefaultSettings, type ClaudeSettings } from '../../domain/settings';
import { accountSwitchView, isListboxKey, moveHighlight } from './account-switch-view';

const PERSONAL = { id: 'a1', name: 'Personal' };
const WORK = { id: 'a2', name: 'Work' };

function claude(accounts: ClaudeSettings['accounts'], activeAccountId: string | null): ClaudeSettings {
  return { ...createDefaultSettings().claude, accounts, activeAccountId };
}

describe('accountSwitchView', () => {
  it('lists the account names on the Usage page when there are two or more accounts, marking the active one', () => {
    expect(accountSwitchView(claude([PERSONAL, WORK], 'a2'), 'usage', 'usage')).toEqual({
      activeId: 'a2',
      activeName: 'Work',
      options: [
        { id: 'a1', name: 'Personal', active: false },
        { id: 'a2', name: 'Work', active: true },
      ],
    });
  });

  it('is hidden on every other page, PRs included', () => {
    for (const page of ['prs', 'reviews', 'sessions', 'teams', 'skills', null]) {
      expect(accountSwitchView(claude([PERSONAL, WORK], 'a1'), page, 'usage')).toBeNull();
    }
  });

  it('is hidden with a single account or none', () => {
    expect(accountSwitchView(claude([PERSONAL], 'a1'), 'usage', 'usage')).toBeNull();
    expect(accountSwitchView(claude([], null), 'usage', 'usage')).toBeNull();
  });

  it('is hidden when no account is active', () => {
    expect(accountSwitchView(claude([PERSONAL, WORK], null), 'usage', 'usage')).toBeNull();
  });
});

describe('listbox keyboard', () => {
  it('recognizes only the navigation keys', () => {
    expect(['ArrowDown', 'ArrowUp', 'Home', 'End'].every(isListboxKey)).toBe(true);
    expect(isListboxKey('Enter')).toBe(false);
    expect(isListboxKey('a')).toBe(false);
  });

  it('moves within the bounds without wrapping', () => {
    expect(moveHighlight(0, 'ArrowDown', 3)).toBe(1);
    expect(moveHighlight(2, 'ArrowDown', 3)).toBe(2);
    expect(moveHighlight(1, 'ArrowUp', 3)).toBe(0);
    expect(moveHighlight(0, 'ArrowUp', 3)).toBe(0);
    expect(moveHighlight(1, 'Home', 3)).toBe(0);
    expect(moveHighlight(0, 'End', 3)).toBe(2);
    expect(moveHighlight(-1, 'ArrowDown', 3)).toBe(0);
    expect(moveHighlight(-1, 'ArrowUp', 3)).toBe(2);
    expect(moveHighlight(0, 'ArrowDown', 0)).toBe(-1);
  });
});
