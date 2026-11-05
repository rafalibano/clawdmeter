import { EXHAUSTION_LEVEL, type UsageWindowKind } from '../../../domain/usage';
import type { UsageThresholds } from '../../../domain/settings';

export type UsageTone = 'base' | 'attention' | 'danger';

export function projectionTone(kind: UsageWindowKind, projected: number, thresholds: UsageThresholds): UsageTone {
  if (projected >= EXHAUSTION_LEVEL) return 'danger';
  if (kind === 'fiveHour') return 'base';
  if (projected >= thresholds.critical) return 'danger';
  return projected >= thresholds.warning ? 'attention' : 'base';
}
