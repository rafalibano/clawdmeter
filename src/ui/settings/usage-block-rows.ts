import type { Localizer } from '../i18n';
import { USAGE_BLOCK_IDS, type UsageBlockId, type UsageBlockSettings } from '../../domain/usage';

export interface UsageBlockRow {
  id: UsageBlockId;
  labelKey: 'settings.usageTab.modelLimits' | 'settings.usageTab.extraUsage' | 'settings.usageTab.resets';
  checked: boolean;
}

const LABEL_KEYS: Record<UsageBlockId, UsageBlockRow['labelKey']> = {
  modelLimits: 'settings.usageTab.modelLimits',
  extraUsage: 'settings.usageTab.extraUsage',
  resets: 'settings.usageTab.resets',
};

export function usageBlockRows(blocks: UsageBlockSettings): UsageBlockRow[] {
  return USAGE_BLOCK_IDS.map((id) => ({ id, labelKey: LABEL_KEYS[id], checked: blocks[id] }));
}

export function usageBlocksSummary(l: Localizer, rows: readonly UsageBlockRow[]): string {
  return l.t('settings.usageTab.summary', {
    active: String(rows.filter((row) => row.checked).length),
    total: String(rows.length),
  });
}
