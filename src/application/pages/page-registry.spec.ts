import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '../../domain/settings';
import { fakePage } from '../testing/fake-page';
import { PageRegistry } from './page-registry';

describe('PageRegistry', () => {
  const usage = fakePage({ id: 'usage', requiredConnections: ['claude'] });
  const prs = fakePage({ id: 'prs', requiredConnections: ['github'] });
  const reviews = fakePage({ id: 'reviews', requiredConnections: ['github'] });
  const registry = new PageRegistry([usage, prs, reviews]);

  it('lists the pages in registration order', () => {
    expect(registry.all().map((page) => page.id)).toEqual(['usage', 'prs', 'reviews']);
  });

  it('looks up by id', () => {
    expect(registry.get('prs')).toBe(prs);
    expect(registry.get('nada')).toBeUndefined();
  });

  it('rejects a duplicate id', () => {
    expect(() => new PageRegistry([usage, fakePage({ id: 'usage' })])).toThrow('Duplicate page: usage');
  });

  it('only returns enabled pages, on by default', () => {
    const settings = { ...createDefaultSettings(), enabledPages: { prs: false } };
    expect(registry.enabled(settings).map((page) => page.id)).toEqual(['usage', 'reviews']);
  });

  it('requires only the connections of enabled pages, without repeating', () => {
    expect(registry.requiredConnections(createDefaultSettings()).sort()).toEqual(['claude', 'github']);
    const noGithub = { ...createDefaultSettings(), enabledPages: { prs: false, reviews: false } };
    expect(registry.requiredConnections(noGithub)).toEqual(['claude']);
  });
});
