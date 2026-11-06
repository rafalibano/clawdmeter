import { activeClaudeAccount, type ClaudeSettings } from '../../domain/settings';

export interface AccountSwitchOption {
  id: string;
  domId: string;
  name: string;
  active: boolean;
}

export interface AccountSwitchView {
  activeId: string;
  activeName: string;
  activeInitials: string;
  options: AccountSwitchOption[];
}

export type ListboxKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export interface SwitchMenuState {
  open: boolean;
  pressed: boolean;
}

export const CLOSED_MENU: SwitchMenuState = { open: false, pressed: false };

export function accountInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== '');
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toLocaleUpperCase();
}

export function accountSwitchView(
  claude: ClaudeSettings,
  pageId: string | null,
  usagePageId: string,
  idPrefix: string,
): AccountSwitchView | null {
  if (pageId !== usagePageId || claude.accounts.length < 2) return null;
  const active = activeClaudeAccount(claude);
  if (active === null) return null;
  return {
    activeId: active.id,
    activeName: active.name,
    activeInitials: accountInitials(active.name),
    options: claude.accounts.map((account) => ({
      id: account.id,
      domId: `${idPrefix}-${account.id}`,
      name: account.name,
      active: account.id === active.id,
    })),
  };
}

export function pressTrigger(state: SwitchMenuState): SwitchMenuState {
  return { ...state, pressed: state.open };
}

export function leaveSwitch(state: SwitchMenuState): SwitchMenuState {
  return state.pressed ? { ...state, pressed: false } : CLOSED_MENU;
}

export function clickTrigger(state: SwitchMenuState): SwitchMenuState {
  return { open: !state.open, pressed: false };
}

export function isListboxKey(key: string): key is ListboxKey {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End';
}

export function moveHighlight(current: number, key: ListboxKey, count: number): number {
  if (count === 0) return -1;
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(count - 1, current + 1);
    case 'ArrowUp':
      return current < 0 ? count - 1 : Math.max(0, current - 1);
  }
}
