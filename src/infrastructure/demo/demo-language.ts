import { isAppLanguage } from '../../domain/settings';

export const DEMO_SETTINGS_KEY = 'dev-pulse.settings';

export function applyDemoLanguage(search: string, storage: Pick<Storage, 'getItem' | 'setItem'>): void {
  const requested = new URLSearchParams(search).get('lang');
  if (!isAppLanguage(requested)) return;
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(DEMO_SETTINGS_KEY) ?? '{}');
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
  } catch {
    stored = {};
  }
  storage.setItem(DEMO_SETTINGS_KEY, JSON.stringify({ ...stored, language: requested }));
}
