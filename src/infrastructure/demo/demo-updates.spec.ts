import { describe, expect, it } from 'vitest';
import { RateLimitedError } from '../../domain/rate-limit';
import { UpdateAccessError } from '../../domain/updates';
import { DemoUpdateChecker, parseDemoUpdateScenario } from './demo-updates';
import { createDemoWorld } from './demo-world';

describe('demo updates', () => {
  it('?demo=update:available offers 0.2.0 and connects GitHub on its own', async () => {
    const world = createDemoWorld('?demo=update:available');
    expect(world.update).toBe('available');
    expect(world.prefs.github.method).toBe('gh-cli');
    expect(await new DemoUpdateChecker(world.update).check()).toEqual({ version: '0.2.0', currentVersion: '0.1.0', notes: null });
  });

  it('keeps an explicit GitHub scenario and defaults to the latest version', async () => {
    const world = createDemoWorld('?demo=update:available,github:disconnected');
    expect(world.prefs.github.method).toBeNull();
    expect(createDemoWorld('').update).toBe('latest');
    expect(await new DemoUpdateChecker('latest').check()).toBeNull();
    expect(parseDemoUpdateScenario('nonsense')).toBe('latest');
  });

  it('simulates the check and install failures', async () => {
    await expect(new DemoUpdateChecker('no-access').check()).rejects.toBeInstanceOf(UpdateAccessError);
    await expect(new DemoUpdateChecker('rate-limited').check()).rejects.toBeInstanceOf(RateLimitedError);
    const progress: number[] = [];
    await expect(new DemoUpdateChecker('install-error', 0).install('t', (step) => progress.push(step.downloaded))).rejects.toThrow();
    expect(progress).toHaveLength(5);
    progress.length = 0;
    await new DemoUpdateChecker('available', 0).install('t', (step) => progress.push(step.downloaded));
    expect(progress).toHaveLength(10);
  });
});
