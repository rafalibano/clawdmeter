import { describe, expect, it } from 'vitest';
import { seriesLineRows } from './series-lines';

describe('consumption lines', () => {
  const values = { fiveHour: '#00b131', sevenDay: '#888888' };

  it('lists 5h and 7d with the current color, in order', () => {
    const rows = seriesLineRows(values, { fiveHour: null, sevenDay: null });
    expect(rows.map((row) => [row.kind, row.labelKey, row.value])).toEqual([
      ['fiveHour', 'settings.seriesFiveHour', '#00b131'],
      ['sevenDay', 'settings.seriesSevenDay', '#888888'],
    ]);
  });

  it('marks as custom only the line with its own color', () => {
    const rows = seriesLineRows(values, { fiveHour: '#ff0000', sevenDay: null });
    expect(rows.map((row) => row.custom)).toEqual([true, false]);
  });
});
