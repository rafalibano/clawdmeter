import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../domain/settings';
import { applyThemeStyle, resolveTheme, THEME_BACKGROUNDS, type ThemeRoot } from './theme-style';

function fakeRoot() {
  const properties = new Map<string, string>();
  const root: ThemeRoot = {
    dataset: {},
    style: {
      setProperty: (name, value) => void properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
  };
  return { root, properties };
}

const appearance = createDefaultSettings().appearance;

describe('resolveTheme', () => {
  it('follows the system only in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('applyThemeStyle', () => {
  it('sets the theme, the accent and readable text over the accent', () => {
    const { root, properties } = fakeRoot();
    applyThemeStyle(root, { ...appearance, accentColor: '#ffffff' }, 'dark');
    expect(root.dataset['theme']).toBe('dark');
    expect(properties.get('--cm-accent')).toBe('#ffffff');
    expect(properties.get('--cm-accent-fg')).toBe('#121212');
  });

  it('with the default Mottu green, text, active and background are left to the theme tokens', () => {
    const { root, properties } = fakeRoot();
    applyThemeStyle(root, { ...appearance, accentColor: '#ff0000' }, 'dark');
    expect(properties.get('--cm-accent-text')).toBe('#ff0000');
    expect(properties.get('--cm-series-five')).toBe('#ff0000');
    expect(properties.get('--cm-accent-active')).toBe('color-mix(in srgb, #ff0000 65%, #000000)');
    applyThemeStyle(root, appearance, 'dark');
    expect(properties.get('--cm-accent')).toBe('#00b131');
    expect(properties.get('--cm-accent-fg')).toBe('#121212');
    expect(properties.get('--cm-series-five')).toBeUndefined();
    expect(properties.has('--cm-accent-text')).toBe(false);
    expect(properties.has('--cm-accent-active')).toBe(false);
  });

  it('without a custom background lets the theme decide bg and fg', () => {
    const { root, properties } = fakeRoot();
    applyThemeStyle(root, { ...appearance, popoverBackground: '#000000' }, 'light');
    expect(properties.get('--cm-bg')).toBe('#000000');
    expect(properties.get('--cm-fg')).toBe('#ffffff');
    expect(properties.get('--cm-surface')).toBe('color-mix(in srgb, var(--cm-fg) 6%, transparent)');
    applyThemeStyle(root, { ...appearance, popoverBackground: null }, 'light');
    for (const name of ['--cm-bg', '--cm-fg', '--cm-surface', '--cm-border', '--cm-muted', '--cm-edge', '--cm-hover', '--cm-control-border', '--cm-track']) {
      expect(properties.has(name)).toBe(false);
    }
  });

  it('exposes the default background of each theme', () => {
    expect(THEME_BACKGROUNDS).toEqual({ light: '#f7f7f7', dark: '#1a1a1a' });
  });
});

describe('series colors', () => {
  it('without a choice, 5h follows the accent and 7d stays on the theme gray', () => {
    const { root, properties } = fakeRoot();
    properties.set('--cm-series-seven', '#ff0000');
    applyThemeStyle(root, appearance, 'light', { fiveHour: null, sevenDay: null });
    expect(properties.has('--cm-series-five')).toBe(false);
    expect(properties.has('--cm-series-seven')).toBe(false);
    applyThemeStyle(root, { ...appearance, accentColor: '#0063f7' }, 'light', { fiveHour: null, sevenDay: null });
    expect(properties.get('--cm-series-five')).toBe('#0063f7');
  });

  it('the chosen color applies to the 5h and 7d bars, above the accent', () => {
    const { root, properties } = fakeRoot();
    applyThemeStyle(root, { ...appearance, accentColor: '#0063f7' }, 'dark', { fiveHour: '#ef6800', sevenDay: '#1bd60b' });
    expect(properties.get('--cm-series-five')).toBe('#ef6800');
    expect(properties.get('--cm-series-seven')).toBe('#1bd60b');
    expect(properties.get('--cm-accent')).toBe('#0063f7');
  });
});
