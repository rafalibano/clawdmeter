import type { Localizer } from '../i18n';
import { QUARTILES, normalizeQuartiles, type Quartile, type UsageAlertSettings, type UsageWindowKind } from '../../domain/usage';

export interface UsageAlertRow {
  kind: UsageWindowKind;
  labelKey: 'settings.seriesFiveHour' | 'settings.seriesSevenDay';
  options: { quartile: Quartile; checked: boolean }[];
}

export function usageAlertRows(alerts: UsageAlertSettings): UsageAlertRow[] {
  const options = (selected: readonly Quartile[]) => QUARTILES.map((quartile) => ({ quartile, checked: selected.includes(quartile) }));
  return [
    { kind: 'fiveHour', labelKey: 'settings.seriesFiveHour', options: options(alerts.fiveHour) },
    { kind: 'sevenDay', labelKey: 'settings.seriesSevenDay', options: options(alerts.sevenDay) },
  ];
}

export function toggleQuartile(selected: readonly Quartile[], quartile: Quartile, checked: boolean): Quartile[] {
  return normalizeQuartiles(checked ? [...selected, quartile] : selected.filter((value) => value !== quartile));
}

export function usageAlertsSummary(l: Localizer, alerts: UsageAlertSettings): string {
  const describe = (selected: readonly Quartile[]) =>
    selected.length === 0 ? l.t('settings.alerts.none') : selected.map((quartile) => `${quartile}%`).join(' ');
  return `${l.t('settings.seriesFiveHour')} ${describe(alerts.fiveHour)} · ${l.t('settings.seriesSevenDay')} ${describe(alerts.sevenDay)}`;
}
