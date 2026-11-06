import { activeClaudeAccount, type ClaudeSettings } from '../../domain/settings';

export interface AccountSwitchOption {
  id: string;
  name: string;
  active: boolean;
}

export interface AccountSwitchView {
  activeId: string;
  activeName: string;
  options: AccountSwitchOption[];
}

export type ListboxKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export function accountSwitchView(claude: ClaudeSettings, pageId: string | null, usagePageId: string): AccountSwitchView | null {
  if (pageId !== usagePageId || claude.accounts.length < 2) return null;
  const active = activeClaudeAccount(claude);
  if (active === null) return null;
  return {
    activeId: active.id,
    activeName: active.name,
    options: claude.accounts.map((account) => ({ id: account.id, name: account.name, active: account.id === active.id })),
  };
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
