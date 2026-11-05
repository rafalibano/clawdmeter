import { describe, expect, it } from 'vitest';
import { HOUR_MS, MINUTE_MS } from '../time';
import {
  UPDATE_CHECK_INTERVAL_MS,
  compareVersions,
  downloadPercent,
  isCheckDue,
  isNewerVersion,
  isRateLimited,
  parseVersion,
  rateLimitedUntil,
  shouldShowUpdateBanner,
  type UpdateStatus,
} from '.';

describe('semver', () => {
  it('parses versions with an optional v, prerelease and build metadata', () => {
    expect(parseVersion('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0, prerelease: [] });
    expect(parseVersion('v1.2.3-beta.2+build.7')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: ['beta', '2'] });
    for (const invalid of ['', '1.2', '01.2.3', '1.2.3.4', 'latest']) expect(parseVersion(invalid), invalid).toBeNull();
  });

  it('orders by major, minor, patch and then prerelease', () => {
    const order = ['0.1.0-alpha', '0.1.0-alpha.1', '0.1.0-beta', '0.1.0-beta.2', '0.1.0-beta.11', '0.1.0', '0.1.1', '0.2.0', '0.10.0', '1.0.0'];
    for (let index = 1; index < order.length; index++) {
      expect(compareVersions(parseVersion(order[index - 1]!)!, parseVersion(order[index]!)!), order[index]).toBe(-1);
      expect(compareVersions(parseVersion(order[index]!)!, parseVersion(order[index - 1]!)!), order[index]).toBe(1);
    }
    expect(compareVersions(parseVersion('1.0.0+a')!, parseVersion('1.0.0+b')!)).toBe(0);
  });

  it('only a strictly newer valid version counts as an update', () => {
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('v0.1.1', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.2.0-rc.1', '0.2.0')).toBe(false);
    expect(isNewerVersion('garbage', '0.1.0')).toBe(false);
  });
});

describe('update banner', () => {
  const cases: Array<[UpdateStatus, boolean]> = [
    [{ state: 'idle' }, false],
    [{ state: 'checking' }, false],
    [{ state: 'github-required' }, false],
    [{ state: 'up-to-date' }, false],
    [{ state: 'available', version: '0.2.0', notes: null }, true],
    [{ state: 'downloading', version: '0.2.0', downloaded: 1, total: 2 }, true],
    [{ state: 'installed', version: '0.2.0' }, true],
    [{ state: 'error', during: 'install', reason: 'failed', version: '0.2.0' }, true],
    [{ state: 'error', during: 'check', reason: 'rate-limited', version: null }, false],
  ];

  it.each(cases)('%j shows the banner: %s', (status, shown) => {
    expect(shouldShowUpdateBanner(status)).toBe(shown);
  });

  it('computes the download percent only with a known total', () => {
    expect(downloadPercent(50, 200)).toBe(25);
    expect(downloadPercent(300, 200)).toBe(100);
    expect(downloadPercent(10, null)).toBeNull();
    expect(downloadPercent(10, 0)).toBeNull();
  });
});

describe('update schedule', () => {
  it('checks on first run and then every 6 hours', () => {
    expect(isCheckDue({ lastAttemptAt: null, blockedUntil: null }, 0)).toBe(true);
    expect(isCheckDue({ lastAttemptAt: 0, blockedUntil: null }, UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(isCheckDue({ lastAttemptAt: 0, blockedUntil: null }, UPDATE_CHECK_INTERVAL_MS)).toBe(true);
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(6 * HOUR_MS);
  });

  it('never checks while GitHub rate-limits the app', () => {
    const schedule = { lastAttemptAt: null, blockedUntil: 10 * MINUTE_MS };
    expect(isRateLimited(schedule, 5 * MINUTE_MS)).toBe(true);
    expect(isCheckDue(schedule, 5 * MINUTE_MS)).toBe(false);
    expect(isCheckDue(schedule, 10 * MINUTE_MS)).toBe(true);
  });

  it('waits for Retry-After, an hour without it, and at least a minute', () => {
    expect(rateLimitedUntil(0, 30 * MINUTE_MS)).toBe(30 * MINUTE_MS);
    expect(rateLimitedUntil(0, null)).toBe(HOUR_MS);
    expect(rateLimitedUntil(0, 1_000)).toBe(MINUTE_MS);
  });
});
