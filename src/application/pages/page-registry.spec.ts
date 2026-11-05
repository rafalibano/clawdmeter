import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../domain/settings';
import { fakePage } from '../testing/fake-page';
import { PageRegistry } from './page-registry';

describe('PageRegistry', () => {
  const usage = fakePage({ id: 'usage', requiredConnections: ['claude'] });
  const prs = fakePage({ id: 'prs', requiredConnections: ['github'] });
  const reviews = fakePage({ id: 'reviews', requiredConnections: ['github'] });
  const registry = new PageRegistry([usage, prs, reviews]);

  it('lista as páginas na ordem de registro', () => {
    expect(registry.all().map((page) => page.id)).toEqual(['usage', 'prs', 'reviews']);
  });

  it('busca por id', () => {
    expect(registry.get('prs')).toBe(prs);
    expect(registry.get('nada')).toBeUndefined();
  });

  it('rejeita id duplicado', () => {
    expect(() => new PageRegistry([usage, fakePage({ id: 'usage' })])).toThrow('Página duplicada: usage');
  });

  it('só devolve páginas habilitadas, ligando por padrão', () => {
    const settings = { ...createDefaultSettings(), enabledPages: { prs: false } };
    expect(registry.enabled(settings).map((page) => page.id)).toEqual(['usage', 'reviews']);
  });

  it('exige só as conexões das páginas habilitadas, sem repetir', () => {
    expect(registry.requiredConnections(createDefaultSettings()).sort()).toEqual(['claude', 'github']);
    const noGithub = { ...createDefaultSettings(), enabledPages: { prs: false, reviews: false } };
    expect(registry.requiredConnections(noGithub)).toEqual(['claude']);
  });
});
