import { describe, expect, it } from 'vitest';
import { createDefaultSettings, type ClaudeSettings } from '../../domain/settings';
import {
  CLOSED_MENU,
  accountInitials,
  accountSwitchView,
  clickTrigger,
  isListboxKey,
  leaveSwitch,
  moveHighlight,
  pressTrigger,
} from './account-switch-view';

const PERSONAL = { id: 'a1', name: 'Personal' };
const WORK = { id: 'a2', name: 'Work' };

function claude(accounts: ClaudeSettings['accounts'], activeAccountId: string | null): ClaudeSettings {
  return { ...createDefaultSettings().claude, accounts, activeAccountId };
}

describe('accountSwitchView', () => {
  it('lists the account names on the Usage page when there are two or more accounts, marking the active one', () => {
    expect(accountSwitchView(claude([PERSONAL, WORK], 'a2'), 'usage', 'usage', 'opt')).toEqual({
      activeId: 'a2',
      activeName: 'Work',
      activeInitials: 'W',
      options: [
        { id: 'a1', domId: 'opt-a1', name: 'Personal', active: false },
        { id: 'a2', domId: 'opt-a2', name: 'Work', active: true },
      ],
    });
  });

  it('the trigger shows at most two initials so the tabs keep their room', () => {
    expect(accountInitials('Work')).toBe('W');
    expect(accountInitials('  mottu   ops team ')).toBe('MO');
    expect(accountInitials('édson')).toBe('É');
    expect(accountInitials('😀 Fun')).toBe('😀F');
  });

  it('is hidden on every other page, PRs included', () => {
    for (const page of ['prs', 'reviews', 'sessions', 'teams', 'skills', null]) {
      expect(accountSwitchView(claude([PERSONAL, WORK], 'a1'), page, 'usage', 'opt')).toBeNull();
    }
  });

  it('is hidden with a single account or none', () => {
    expect(accountSwitchView(claude([PERSONAL], 'a1'), 'usage', 'usage', 'opt')).toBeNull();
    expect(accountSwitchView(claude([], null), 'usage', 'usage', 'opt')).toBeNull();
  });

  it('is hidden when no account is active', () => {
    expect(accountSwitchView(claude([PERSONAL, WORK], null), 'usage', 'usage', 'opt')).toBeNull();
  });
});

describe('switch menu open state', () => {
  const opened = clickTrigger(CLOSED_MENU);

  it('a click on the trigger opens and the next one closes', () => {
    expect(opened.open).toBe(true);
    expect(clickTrigger(opened).open).toBe(false);
  });

  it('pressing the trigger of an open menu, losing focus to nowhere and clicking closes it instead of reopening it', () => {
    const blurred = leaveSwitch(pressTrigger(opened));
    expect(blurred.open).toBe(true);
    expect(clickTrigger(blurred)).toEqual(CLOSED_MENU);
  });

  it('losing focus without pressing the trigger closes the menu, and a later click opens it again', () => {
    const left = leaveSwitch(opened);
    expect(left).toEqual(CLOSED_MENU);
    expect(clickTrigger(left).open).toBe(true);
  });

  it('pressing the trigger of a closed menu still opens it', () => {
    expect(clickTrigger(leaveSwitch(pressTrigger(CLOSED_MENU))).open).toBe(true);
  });

  it('the press only covers the focus loss it caused', () => {
    const blurred = leaveSwitch(pressTrigger(opened));
    expect(leaveSwitch(blurred)).toEqual(CLOSED_MENU);
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
