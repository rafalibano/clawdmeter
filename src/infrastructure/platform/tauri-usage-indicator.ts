import type { UsageIndicator } from '../../application/ports';
import { describeUsageTooltip, type UsageSnapshot } from '../../domain/usage';
import type { TauriCommands } from './tauri-commands';

export class TauriUsageIndicator implements UsageIndicator {
  constructor(private readonly commands: TauriCommands) {}

  update(snapshot: UsageSnapshot | null, now: number): Promise<void> {
    return this.commands.call<void>('tray_set_usage', {
      fiveHour: snapshot?.fiveHour?.utilization ?? null,
      sevenDay: snapshot?.sevenDay?.utilization ?? null,
      tooltip: describeUsageTooltip(snapshot, now),
    });
  }
}
