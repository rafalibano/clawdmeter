import type { Translator, UsageIndicator } from '../../application/ports';
import { describeUsageTooltip, type UsageSnapshot, type UsageTooltipTexts } from '../../domain/usage';
import type { TauriCommands } from './tauri-commands';

export function tooltipTexts(translator: Translator): UsageTooltipTexts {
  return {
    locale: translator.locale,
    unavailable: translator.t('tooltip.unavailable'),
    noData: (label) => translator.t('tooltip.noData', { label }),
    resets: (when) => translator.t('tooltip.resets', { when }),
  };
}

export class TauriUsageIndicator implements UsageIndicator {
  constructor(
    private readonly commands: TauriCommands,
    private readonly translator: Translator,
  ) {}

  update(snapshot: UsageSnapshot | null, now: number): Promise<void> {
    return this.commands.call<void>('tray_set_usage', {
      fiveHour: snapshot?.fiveHour?.utilization ?? null,
      sevenDay: snapshot?.sevenDay?.utilization ?? null,
      tooltip: describeUsageTooltip(snapshot, now, tooltipTexts(this.translator)),
    });
  }
}
