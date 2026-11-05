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
  it('segue o sistema só no modo system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('applyThemeStyle', () => {
  it('define tema, destaque e texto legível sobre o destaque', () => {
    const { root, properties } = fakeRoot();
    applyThemeStyle(root, { ...appearance, accentColor: '#ffffff' }, 'dark');
    expect(root.dataset['theme']).toBe('dark');
    expect(properties.get('--cm-accent')).toBe('#ffffff');
    expect(properties.get('--cm-accent-fg')).toBe('#121212');
  });

  it('com o verde Mottu padrão, texto, ativo e fundo ficam por conta dos tokens do tema', () => {
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

  it('sem fundo personalizado deixa o tema decidir bg e fg', () => {
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

  it('expõe o fundo padrão de cada tema', () => {
    expect(THEME_BACKGROUNDS).toEqual({ light: '#f7f7f7', dark: '#1a1a1a' });
  });
});
