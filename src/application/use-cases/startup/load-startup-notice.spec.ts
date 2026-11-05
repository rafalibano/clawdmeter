import { describe, expect, it } from 'vitest';
import { LoadStartupNotice } from './load-startup-notice';

describe('LoadStartupNotice', () => {
  it('returns what the platform reports', async () => {
    expect(await new LoadStartupNotice({ pending: async () => 'no-tray' }).execute()).toBe('no-tray');
    expect(await new LoadStartupNotice({ pending: async () => null }).execute()).toBeNull();
  });

  it('a failing platform query is no notice', async () => {
    const notices = {
      pending: async () => {
        throw new Error('ipc down');
      },
    };
    expect(await new LoadStartupNotice(notices).execute()).toBeNull();
  });
});
