import { describe, expect, it } from 'vitest';
import { seriesLineRows } from './series-lines';

describe('linhas de consumo', () => {
  const values = { fiveHour: '#00b131', sevenDay: '#888888' };

  it('lista 5h e 7d com a cor atual, na ordem', () => {
    const rows = seriesLineRows(values, { fiveHour: null, sevenDay: null });
    expect(rows.map((row) => [row.kind, row.labelKey, row.value])).toEqual([
      ['fiveHour', 'settings.seriesFiveHour', '#00b131'],
      ['sevenDay', 'settings.seriesSevenDay', '#888888'],
    ]);
  });

  it('marca como personalizada só a linha com cor própria', () => {
    const rows = seriesLineRows(values, { fiveHour: '#ff0000', sevenDay: null });
    expect(rows.map((row) => row.custom)).toEqual([true, false]);
  });
});
