import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings, MAINTENANCE_PAGES } from '../../domain/settings';
import { FakeComponent, fakePage } from '../testing/fake-page';
import { PageRegistry } from './page-registry';
import { underMaintenance } from './under-maintenance';

describe('underMaintenance', () => {
  const load = vi.fn(async () => ({ real: true }));
  const real = fakePage({ id: 'teams', requiredConnections: ['microsoft', 'notifications'], pollIntervalMs: 60_000, load });
  class Placeholder {}
  const page = underMaintenance(real, Placeholder);

  it('keeps id and title, but without polling or connections', () => {
    expect(page.id).toBe('teams');
    expect(page.title).toBe(real.title);
    expect(page.pollIntervalMs).toBeNull();
    expect(page.requiredConnections).toEqual([]);
    expect(page.component).toBe(Placeholder);
    expect(page.component).not.toBe(FakeComponent);
  });

  it('load does not call the real load', async () => {
    await page.load();
    expect(load).not.toHaveBeenCalled();
  });

  it('enabled, requires no connections', () => {
    const settings = { ...createDefaultSettings(), enabledPages: { teams: true } };
    expect(new PageRegistry([page]).requiredConnections(settings)).toEqual([]);
  });

  it('Skills and Agenda are in the maintenance list and off by default', () => {
    expect([...MAINTENANCE_PAGES].sort()).toEqual(['skills', 'teams']);
    const registry = new PageRegistry([real, fakePage({ id: 'skills' })]);
    expect(registry.enabled(createDefaultSettings())).toEqual([]);
  });
});
