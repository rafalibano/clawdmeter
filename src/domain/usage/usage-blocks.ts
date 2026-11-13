import { isRecord } from './payload';

export type UsageBlockId = 'modelLimits' | 'extraUsage' | 'resets';

export const USAGE_BLOCK_IDS: readonly UsageBlockId[] = ['modelLimits', 'extraUsage', 'resets'];

export type UsageBlockSettings = Record<UsageBlockId, boolean>;

export function defaultUsageBlocks(): UsageBlockSettings {
  return { modelLimits: true, extraUsage: true, resets: true };
}

export function normalizeUsageBlocks(value: unknown, current: UsageBlockSettings = defaultUsageBlocks()): UsageBlockSettings {
  const given = isRecord(value) ? value : {};
  const blocks = { ...current };
  for (const id of USAGE_BLOCK_IDS) {
    const flag = given[id];
    if (typeof flag === 'boolean') blocks[id] = flag;
  }
  return blocks;
}
