import type { UsageIndicator } from '../../application/ports';

export class DemoUsageIndicator implements UsageIndicator {
  async update(): Promise<void> {}
}
