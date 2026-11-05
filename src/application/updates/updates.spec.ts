import { describe, expect, it } from 'vitest';
import { RateLimitedError } from '../../domain/rate-limit';
import { HOUR_MS, MINUTE_MS } from '../../domain/time';
import { UpdateAccessError, type UpdateSnapshot } from '../../domain/updates';
import { GitHubTokenResolver } from '../connections/github-token-resolver';
import { GitHubSession } from '../pull-requests/github-session';
import { FakeClock, flushPromises } from '../testing/fake-clock';
import { FakeConnectionPrefsStore, FakeGitHubCli, FakeSecretStore } from '../testing/fake-connection-adapters';
import { FakeUpdateChecker } from '../testing/fake-update-checker';
import { Updates } from './updates';

const AVAILABLE = { version: '0.2.0', currentVersion: '0.1.0', notes: 'Fixes' };

function setup(connected = true) {
  const clock = new FakeClock();
  const checker = new FakeUpdateChecker();
  const prefs = new FakeConnectionPrefsStore();
  if (connected) prefs.current.github.method = 'gh-cli';
  const cli = new FakeGitHubCli();
  const updates = new Updates(checker, new GitHubSession(prefs, new GitHubTokenResolver(cli, new FakeSecretStore())), clock);
  const seen: UpdateSnapshot[] = [];
  updates.subscribe((snapshot) => seen.push(snapshot));
  return { clock, checker, prefs, cli, updates, seen, state: () => updates.current.status };
}

describe('Updates', () => {
  it('checks on start with the GitHub token and reports the new version', async () => {
    const { clock, checker, updates, state } = setup();
    checker.outcome = AVAILABLE;
    const stop = updates.start();
    await flushPromises();
    expect(checker.checks).toEqual(['gh-token']);
    expect(state()).toEqual({ state: 'available', version: '0.2.0', notes: 'Fixes' });
    expect(updates.current.currentVersion).toBe('0.1.0');
    expect(updates.current.lastCheckedAt).toBe(0);
    stop();
    expect(clock.activeTimers()).toBe(0);
  });

  it('does not call GitHub without a GitHub connection', async () => {
    const { checker, updates, state } = setup(false);
    updates.start();
    await flushPromises();
    expect(checker.checks).toEqual([]);
    expect(state()).toEqual({ state: 'github-required' });
    expect(updates.current.currentVersion).toBe('0.1.0');
  });

  it('starts checking once GitHub gets connected, on the next tick', async () => {
    const { clock, checker, prefs, updates, state } = setup(false);
    updates.start();
    await flushPromises();
    prefs.current.github.method = 'gh-cli';
    await clock.advance(15 * MINUTE_MS);
    expect(checker.checks).toHaveLength(1);
    expect(state()).toEqual({ state: 'up-to-date' });
  });

  it('treats a gh CLI without a token as not connected', async () => {
    const { checker, cli, updates, state } = setup();
    cli.outcome = { missing: 'not-logged-in' };
    await updates.checkNow();
    expect(checker.checks).toEqual([]);
    expect(state()).toEqual({ state: 'github-required' });
  });

  it('checks again only every 6 hours', async () => {
    const { clock, checker, updates } = setup();
    updates.start();
    await flushPromises();
    await clock.advance(6 * HOUR_MS - MINUTE_MS);
    expect(checker.checks).toHaveLength(1);
    await clock.advance(15 * MINUTE_MS);
    expect(checker.checks).toHaveLength(2);
  });

  it('ignores a version that is not newer than the installed one', async () => {
    const { checker, updates, state } = setup();
    checker.outcome = { version: '0.1.0', currentVersion: '0.1.0', notes: null };
    await updates.checkNow();
    expect(state()).toEqual({ state: 'up-to-date' });
  });

  it('respects the GitHub rate limit, even for "check now"', async () => {
    const { clock, checker, updates, state } = setup();
    checker.outcome = new RateLimitedError(30 * MINUTE_MS);
    await updates.checkNow();
    expect(state()).toEqual({ state: 'error', during: 'check', reason: 'rate-limited', version: null });
    checker.outcome = AVAILABLE;
    await clock.advance(20 * MINUTE_MS);
    await updates.checkNow();
    expect(checker.checks).toHaveLength(1);
    await clock.advance(10 * MINUTE_MS);
    await updates.checkNow();
    expect(checker.checks).toHaveLength(2);
    expect(state().state).toBe('available');
  });

  it('separates missing access from other failures', async () => {
    const { checker, updates, state } = setup();
    checker.outcome = new UpdateAccessError();
    await updates.checkNow();
    expect(state()).toEqual({ state: 'error', during: 'check', reason: 'no-access', version: null });
    checker.outcome = new Error('boom');
    await updates.checkNow();
    expect(state()).toEqual({ state: 'error', during: 'check', reason: 'failed', version: null });
  });

  it('downloads with progress, installs and restarts only when asked', async () => {
    const { checker, updates, seen, state } = setup();
    checker.outcome = AVAILABLE;
    checker.progress = [
      { downloaded: 5, total: 10 },
      { downloaded: 10, total: 10 },
    ];
    await updates.checkNow();
    await updates.install();
    expect(checker.installs).toEqual(['gh-token']);
    expect(seen.map((snapshot) => snapshot.status).filter((status) => status.state === 'downloading')).toEqual([
      { state: 'downloading', version: '0.2.0', downloaded: 0, total: null },
      { state: 'downloading', version: '0.2.0', downloaded: 5, total: 10 },
      { state: 'downloading', version: '0.2.0', downloaded: 10, total: 10 },
    ]);
    expect(state()).toEqual({ state: 'installed', version: '0.2.0' });
    expect(checker.restarts).toBe(0);
    await updates.checkNow();
    expect(checker.checks).toHaveLength(1);
    await updates.restart();
    expect(checker.restarts).toBe(1);
  });

  it('keeps the version after a failed install so "try again" can retry it', async () => {
    const { checker, updates, state } = setup();
    checker.outcome = AVAILABLE;
    checker.installOutcome = new Error('disk full');
    await updates.checkNow();
    await updates.install();
    expect(state()).toEqual({ state: 'error', during: 'install', reason: 'failed', version: '0.2.0' });
    checker.installOutcome = null;
    await updates.install();
    expect(state()).toEqual({ state: 'installed', version: '0.2.0' });
  });

  it('does nothing on install without an available update', async () => {
    const { checker, updates } = setup();
    await updates.install();
    expect(checker.installs).toEqual([]);
  });
});
