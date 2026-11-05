import type { UsageSnapshot } from '../../domain/usage';

export interface UsageIndicator {
  update(snapshot: UsageSnapshot | null, now: number): Promise<void>;
}
