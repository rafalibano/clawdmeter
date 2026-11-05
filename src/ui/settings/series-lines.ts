import type { SeriesColorSettings } from '../../domain/settings';
import type { UsageWindowKind } from '../../domain/usage';

export interface SeriesLineRow {
  kind: UsageWindowKind;
  labelKey: 'settings.seriesFiveHour' | 'settings.seriesSevenDay';
  value: string;
  custom: boolean;
}

export function seriesLineRows(values: Record<UsageWindowKind, string>, overrides: SeriesColorSettings): SeriesLineRow[] {
  return [
    { kind: 'fiveHour', labelKey: 'settings.seriesFiveHour', value: values.fiveHour, custom: overrides.fiveHour !== null },
    { kind: 'sevenDay', labelKey: 'settings.seriesSevenDay', value: values.sevenDay, custom: overrides.sevenDay !== null },
  ];
}
