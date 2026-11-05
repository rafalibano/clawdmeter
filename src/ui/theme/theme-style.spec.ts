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
    expect(properties.get('--dp-accent')).toBe('#ffffff');
    expect(properties.get('--dp-accent-fg')).toBe('#1c1c1e');
  });

  it('sem fundo personalizado deixa o tema decidir bg e fg', () => {
    const { root, properties } = fakeRoot();
    applyThemeStyle(root, { ...appearance, popoverBackground: '#000000' }, 'light');
    expect(properties.get('--dp-bg')).toBe('#000000');
    expect(properties.get('--dp-fg')).toBe('#f5f5f7');
    applyThemeStyle(root, { ...appearance, popoverBackground: null }, 'light');
    expect(properties.has('--dp-bg')).toBe(false);
    expect(properties.has('--dp-fg')).toBe(false);
  });

  it('expõe o fundo padrão de cada tema', () => {
    expect(THEME_BACKGROUNDS).toEqual({ light: '#ffffff', dark: '#1c1c1e' });
  });
});
