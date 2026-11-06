import { describe, expect, it } from 'vitest';
import { Localizer } from '../i18n';
import { toggleQuartile, usageAlertRows, usageAlertsSummary } from './usage-alert-rows';

describe('usage alert rows', () => {
  it('lists 5h and 7d with the four quartiles, marking the selected ones', () => {
    const rows = usageAlertRows({ fiveHour: [50], sevenDay: [25, 100] });
    expect(rows.map((row) => [row.kind, row.labelKey])).toEqual([
      ['fiveHour', 'settings.seriesFiveHour'],
      ['sevenDay', 'settings.seriesSevenDay'],
    ]);
    expect(rows[0].options.map((option) => option.quartile)).toEqual([25, 50, 75, 100]);
    expect(rows[0].options.map((option) => option.checked)).toEqual([false, true, false, false]);
    expect(rows[1].options.map((option) => option.checked)).toEqual([true, false, false, true]);
  });

  it('toggling keeps the list sorted and without duplicates', () => {
    expect(toggleQuartile([75], 25, true)).toEqual([25, 75]);
    expect(toggleQuartile([25, 75], 75, true)).toEqual([25, 75]);
    expect(toggleQuartile([25, 75], 25, false)).toEqual([75]);
    expect(toggleQuartile([50], 50, false)).toEqual([]);
  });

  it('summary shows the quartiles of each window and says off for an empty one', () => {
    expect(usageAlertsSummary(new Localizer('en'), { fiveHour: [50, 100], sevenDay: [] })).toBe('5h 50% 100% · 7d Off');
    expect(usageAlertsSummary(new Localizer('pt-BR'), { fiveHour: [], sevenDay: [25] })).toBe('5h Desligado · 7d 25%');
  });
});
