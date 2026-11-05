import { describe, expect, it } from 'vitest';
import { RateLimitedError } from '../../domain/rate-limit';
import { UpdateAccessError } from '../../domain/updates';
import { createFakeCommands, rejectWith } from '../testing/fakes';
import { PlatformCommandError } from '../platform/tauri-commands';
import { TauriUpdateChecker, type DownloadChannel } from './tauri-update-checker';

const version = async () => '0.1.0';

describe('TauriUpdateChecker', () => {
  it('reports the app version', async () => {
    const { commands } = createFakeCommands(() => null);
    expect(await new TauriUpdateChecker(commands, version).currentVersion()).toBe('0.1.0');
  });

  it('sends the token to updater_check and maps the update', async () => {
    const { commands, calls } = createFakeCommands(() => ({ version: '0.2.0', currentVersion: '0.1.0', notes: null, date: 1 }));
    const update = await new TauriUpdateChecker(commands, version).check('ghp_x');
    expect(calls).toEqual([{ command: 'updater_check', args: { token: 'ghp_x' } }]);
    expect(update).toEqual({ version: '0.2.0', currentVersion: '0.1.0', notes: null });
  });

  it('returns null when there is no update', async () => {
    const { commands } = createFakeCommands(() => null);
    expect(await new TauriUpdateChecker(commands, version).check('t')).toBeNull();
  });

  it('turns 401, 403 and 404 into an access error and keeps the rate limit typed', async () => {
    for (const status of [401, 403, 404]) {
      const { commands } = createFakeCommands(() => rejectWith('http', `GitHub returned ${status} for the release`));
      await expect(new TauriUpdateChecker(commands, version).check('t')).rejects.toBeInstanceOf(UpdateAccessError);
    }
    const limited = createFakeCommands(() => rejectWith('rate_limited', 'slow', { retryAfterSecs: 60 }));
    await expect(new TauriUpdateChecker(limited.commands, version).check('t')).rejects.toBeInstanceOf(RateLimitedError);
    const failed = createFakeCommands(() => rejectWith('http', 'GitHub returned 500 for the release'));
    await expect(new TauriUpdateChecker(failed.commands, version).check('t')).rejects.toBeInstanceOf(PlatformCommandError);
  });

  it('streams the download progress through the channel', async () => {
    const channel: DownloadChannel = { onmessage: () => undefined };
    const { commands, calls } = createFakeCommands(() => {
      channel.onmessage({ event: 'progress', data: { downloaded: 5, total: 10 } });
      channel.onmessage({ event: 'finished' });
      return null;
    });
    const progress: unknown[] = [];
    await new TauriUpdateChecker(commands, version, () => channel).install('t', (step) => progress.push(step));
    expect(calls[0]).toEqual({ command: 'updater_install', args: { token: 't', onEvent: channel } });
    expect(progress).toEqual([{ downloaded: 5, total: 10 }]);
  });

  it('restarts through updater_restart', async () => {
    const { commands, calls } = createFakeCommands(() => null);
    await new TauriUpdateChecker(commands, version).restart();
    expect(calls).toEqual([{ command: 'updater_restart', args: undefined }]);
  });
});
