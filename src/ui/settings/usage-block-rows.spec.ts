import { describe, expect, it } from 'vitest';
import { Localizer } from '../i18n';
import { usageBlockRows, usageBlocksSummary } from './usage-block-rows';

describe('usage block rows', () => {
  it('lists model limits, extra usage and resets in the order they appear on the Usage tab', () => {
    const rows = usageBlockRows({ modelLimits: true, extraUsage: false, resets: true });
    expect(rows).toEqual([
      { id: 'modelLimits', labelKey: 'settings.usageTab.modelLimits', checked: true },
      { id: 'extraUsage', labelKey: 'settings.usageTab.extraUsage', checked: false },
      { id: 'resets', labelKey: 'settings.usageTab.resets', checked: true },
    ]);
  });

  it('summary counts the blocks that are on, in each language', () => {
    const rows = usageBlockRows({ modelLimits: true, extraUsage: false, resets: true });
    expect(usageBlocksSummary(new Localizer('en'), rows)).toBe('2 of 3 blocks on');
    expect(usageBlocksSummary(new Localizer('pt-BR'), rows)).toBe('2 de 3 blocos ligados');
    expect(usageBlocksSummary(new Localizer('es-MX'), rows)).toBe('2 de 3 bloques activos');
  });
});
