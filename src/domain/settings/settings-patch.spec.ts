import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from './defaults';
import { applyPatch, mergePatches } from './settings-patch';
import { isPageEnabled } from './page-enabled';

describe('applyPatch', () => {
  it('turns pages on and off without touching the others', () => {
    const base = { ...createDefaultSettings(), enabledPages: { a: true } };
    const next = applyPatch(base, { enabledPages: { b: false } });
    expect(next.enabledPages).toEqual({ a: true, b: false });
    expect(base.enabledPages).toEqual({ a: true });
  });

  it('applies partial appearance and normalizes colors', () => {
    const next = applyPatch(createDefaultSettings(), { appearance: { accentColor: '#FF0000', theme: 'dark' } });
    expect(next.appearance.accentColor).toBe('#ff0000');
    expect(next.appearance.theme).toBe('dark');
  });

  it('ignores invalid color and theme', () => {
    const base = createDefaultSettings();
    const next = applyPatch(base, {
      appearance: { accentColor: 'azul', popoverBackground: 'x', theme: 'neon' as never },
    });
    expect(next.appearance).toEqual(base.appearance);
  });

  it('allows resetting the popover background to the default with null', () => {
    const colored = applyPatch(createDefaultSettings(), { appearance: { popoverBackground: '#202020' } });
    expect(colored.appearance.popoverBackground).toBe('#202020');
    expect(applyPatch(colored, { appearance: { popoverBackground: null } }).appearance.popoverBackground).toBeNull();
  });
});

describe('language in the patch', () => {
  it('changes the language and ignores an unknown value', () => {
    const base = createDefaultSettings();
    expect(applyPatch(base, { language: 'pt-BR' }).language).toBe('pt-BR');
    expect(applyPatch(base, { language: 'fr' as never }).language).toBe('en');
    expect(applyPatch(base, {}).language).toBe('en');
  });

  it('the merge preserves the language', () => {
    expect(mergePatches({ language: 'pt-BR' }, {}).language).toBe('pt-BR');
  });
});

describe('projection method in the patch', () => {
  it('changes the method and ignores an unknown value', () => {
    const base = createDefaultSettings();
    expect(applyPatch(base, { projectionMethod: 'since-reset' }).projectionMethod).toBe('since-reset');
    expect(applyPatch(base, { projectionMethod: 'regressao' as never }).projectionMethod).toBe('7d');
    expect(applyPatch(base, {}).projectionMethod).toBe('7d');
    expect(applyPatch(base, { projectionMethod: '14d' }).projectionMethod).toBe('14d');
    expect(mergePatches({ projectionMethod: 'since-reset' }, {}).projectionMethod).toBe('since-reset');
  });
});

describe('mergePatches', () => {
  it('the second patch wins on the same fields', () => {
    const merged = mergePatches(
      { enabledPages: { a: true }, appearance: { accentColor: '#111111' } },
      { enabledPages: { a: false, b: true }, appearance: { theme: 'light' } },
    );
    expect(merged).toEqual({
      enabledPages: { a: false, b: true },
      appearance: { accentColor: '#111111', theme: 'light' },
    });
  });
});

describe('isPageEnabled', () => {
  it('treats a page without an explicit choice as enabled', () => {
    const settings = { ...createDefaultSettings(), enabledPages: { off: false } };
    expect(isPageEnabled(settings, 'novo')).toBe(true);
    expect(isPageEnabled(settings, 'off')).toBe(false);
  });
});

describe('series colors in the patch', () => {
  it('changes each color, resets to the default with null and ignores an invalid hex', () => {
    const base = createDefaultSettings();
    const blue = applyPatch(base, { seriesColors: { fiveHour: '#0063F7' } });
    expect(blue.seriesColors).toEqual({ fiveHour: '#0063f7', sevenDay: null });
    const both = applyPatch(blue, { seriesColors: { sevenDay: '#ef6800', fiveHour: 'azul' } });
    expect(both.seriesColors).toEqual({ fiveHour: '#0063f7', sevenDay: '#ef6800' });
    expect(applyPatch(both, { seriesColors: { fiveHour: null } }).seriesColors).toEqual({ fiveHour: null, sevenDay: '#ef6800' });
  });

  it('mergePatches combines both colors', () => {
    expect(mergePatches({ seriesColors: { fiveHour: '#111111' } }, { seriesColors: { sevenDay: null } }).seriesColors).toEqual({
      fiveHour: '#111111',
      sevenDay: null,
    });
    expect(mergePatches({}, {})).not.toHaveProperty('seriesColors');
  });
});

describe('usage alerts in the patch', () => {
  it('changes each window and keeps the other untouched', () => {
    const next = applyPatch(createDefaultSettings(), { usageAlerts: { fiveHour: [25, 75] } });
    expect(next.usageAlerts).toEqual({ fiveHour: [25, 75], sevenDay: [50] });
  });

  it('normalizes the list and allows an empty one', () => {
    const base = createDefaultSettings();
    expect(applyPatch(base, { usageAlerts: { sevenDay: [100, 25, 25, 33 as never] } }).usageAlerts.sevenDay).toEqual([25, 100]);
    expect(applyPatch(base, { usageAlerts: { sevenDay: [] } }).usageAlerts.sevenDay).toEqual([]);
  });

  it('ignores a value that is not a list', () => {
    const base = createDefaultSettings();
    expect(applyPatch(base, { usageAlerts: { fiveHour: 'x' as never, sevenDay: 50 as never } }).usageAlerts).toEqual(base.usageAlerts);
    expect(applyPatch(base, {}).usageAlerts).toEqual(base.usageAlerts);
  });

  it('mergePatches combines both windows', () => {
    expect(mergePatches({ usageAlerts: { fiveHour: [25] } }, { usageAlerts: { sevenDay: [] } }).usageAlerts).toEqual({
      fiveHour: [25],
      sevenDay: [],
    });
    expect(mergePatches({}, {})).not.toHaveProperty('usageAlerts');
  });
});
