import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from './defaults';
import { applyPatch, mergePatches } from './settings-patch';
import { isPageEnabled } from './page-enabled';

describe('applyPatch', () => {
  it('liga e desliga páginas sem tocar nas outras', () => {
    const base = { ...createDefaultSettings(), enabledPages: { a: true } };
    const next = applyPatch(base, { enabledPages: { b: false } });
    expect(next.enabledPages).toEqual({ a: true, b: false });
    expect(base.enabledPages).toEqual({ a: true });
  });

  it('aplica aparência parcial e normaliza cores', () => {
    const next = applyPatch(createDefaultSettings(), { appearance: { accentColor: '#FF0000', theme: 'dark' } });
    expect(next.appearance.accentColor).toBe('#ff0000');
    expect(next.appearance.theme).toBe('dark');
  });

  it('ignora cor e tema inválidos', () => {
    const base = createDefaultSettings();
    const next = applyPatch(base, {
      appearance: { accentColor: 'azul', popoverBackground: 'x', theme: 'neon' as never },
    });
    expect(next.appearance).toEqual(base.appearance);
  });

  it('permite voltar o fundo do popover ao padrão com null', () => {
    const colored = applyPatch(createDefaultSettings(), { appearance: { popoverBackground: '#202020' } });
    expect(colored.appearance.popoverBackground).toBe('#202020');
    expect(applyPatch(colored, { appearance: { popoverBackground: null } }).appearance.popoverBackground).toBeNull();
  });
});

describe('idioma e faixas no patch', () => {
  it('troca o idioma e ignora valor desconhecido', () => {
    const base = createDefaultSettings();
    expect(applyPatch(base, { language: 'en' }).language).toBe('en');
    expect(applyPatch(base, { language: 'fr' as never }).language).toBe('pt-BR');
    expect(applyPatch(base, {}).language).toBe('pt-BR');
  });

  it('aplica faixas válidas, mesmo parciais, e ignora as inválidas', () => {
    const base = createDefaultSettings();
    expect(applyPatch(base, { usageThresholds: { warning: 50, critical: 80 } }).usageThresholds).toEqual({ warning: 50, critical: 80 });
    expect(applyPatch(base, { usageThresholds: { warning: 60 } }).usageThresholds).toEqual({ warning: 60, critical: 90 });
    expect(applyPatch(base, { usageThresholds: { warning: 95 } }).usageThresholds).toEqual({ warning: 70, critical: 90 });
    expect(applyPatch(base, { usageThresholds: { critical: 101 } }).usageThresholds).toEqual({ warning: 70, critical: 90 });
    expect(applyPatch(base, { usageThresholds: { warning: 0, critical: 10 } }).usageThresholds).toEqual({ warning: 70, critical: 90 });
  });

  it('o merge junta idioma e faixas', () => {
    const merged = mergePatches({ language: 'en', usageThresholds: { warning: 50 } }, { usageThresholds: { critical: 95 } });
    expect(merged).toMatchObject({ language: 'en', usageThresholds: { warning: 50, critical: 95 } });
  });
});

describe('mergePatches', () => {
  it('o segundo patch vence nos mesmos campos', () => {
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
  it('considera ligada a página sem escolha explícita', () => {
    const settings = { ...createDefaultSettings(), enabledPages: { off: false } };
    expect(isPageEnabled(settings, 'novo')).toBe(true);
    expect(isPageEnabled(settings, 'off')).toBe(false);
  });
});
