import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from '../time';
import {
  blockedWindows,
  isGrantUsable,
  liveGrants,
  parseUsageResets,
  recommendedGrant,
  totalResetsLeft,
  type ResetGrant,
  type UsageResets,
} from './usage-resets';
import type { UsageSnapshot } from './usage-snapshot';

const NOW = Date.parse('2026-11-13T12:00:00Z');

const rawGrant = (overrides: Record<string, unknown> = {}) => ({
  id: 'g1',
  label: 'Launch gift',
  resets_total: 3,
  resets_left: 2,
  starts_at: '2026-11-01T00:00:00Z',
  ends_at: '2026-11-20T00:00:00Z',
  clears: 'five_hour',
  paused: false,
  usable_now: true,
  use_requires_limit: true,
  type: 'session',
  gives_back_weekly: false,
  unavailable_reason: null,
  ...overrides,
});

const rawBlock = (grants: unknown[], overrides: Record<string, unknown> = {}) => ({
  eligible: true,
  ineligible_reason: null,
  at_limit: false,
  exhausted: [],
  next_grant_id: null,
  weekly_resets_at: null,
  cooldown_until: null,
  grants,
  ...overrides,
});

const grant = (overrides: Partial<ResetGrant> = {}): ResetGrant => ({
  id: 'g',
  label: null,
  type: 'session',
  resetsLeft: 1,
  resetsTotal: 1,
  startsAt: null,
  endsAt: NOW + DAY_MS,
  clears: ['fiveHour'],
  clearsScoped: [],
  paused: false,
  usableNow: true,
  ...overrides,
});

const resets = (grants: ResetGrant[], overrides: Partial<UsageResets> = {}): UsageResets => ({
  atLimit: false,
  exhausted: [],
  exhaustedScoped: [],
  grants,
  ...overrides,
});

const snapshot = (fiveHour: number, sevenDay: number): UsageSnapshot => ({
  fiveHour: { utilization: fiveHour, resetsAt: null },
  sevenDay: { utilization: sevenDay, resetsAt: null },
});

describe('parseUsageResets', () => {
  it('reads the grants with their type, what they clear, expiry and usability', () => {
    const parsed = parseUsageResets(rawBlock([rawGrant()], { at_limit: true, exhausted: ['five_hour'] }));
    expect(parsed).toEqual({
      atLimit: true,
      exhausted: ['fiveHour'],
      exhaustedScoped: [],
      grants: [
        {
          id: 'g1',
          label: 'Launch gift',
          type: 'session',
          resetsLeft: 2,
          resetsTotal: 3,
          startsAt: Date.parse('2026-11-01T00:00:00Z'),
          endsAt: Date.parse('2026-11-20T00:00:00Z'),
          clears: ['fiveHour'],
          clearsScoped: [],
          paused: false,
          usableNow: true,
        },
      ],
    });
  });

  it('is null when the block is absent, not an object, ineligible or has no grants', () => {
    expect(parseUsageResets(null)).toBeNull();
    expect(parseUsageResets(undefined)).toBeNull();
    expect(parseUsageResets('x')).toBeNull();
    expect(parseUsageResets([])).toBeNull();
    expect(parseUsageResets({})).toBeNull();
    expect(parseUsageResets(rawBlock([rawGrant()], { eligible: false, ineligible_reason: 'surface' }))).toBeNull();
    expect(parseUsageResets(rawBlock([rawGrant()], { eligible: 'true' }))).toBeNull();
    expect(parseUsageResets(rawBlock([]))).toBeNull();
    expect(parseUsageResets(rawBlock([], { grants: null }))).toBeNull();
    expect(parseUsageResets(rawBlock([], { grants: 'x' }))).toBeNull();
  });

  it('skips unknown or malformed grants without failing the rest', () => {
    const parsed = parseUsageResets(
      rawBlock([
        null,
        'x',
        7,
        [],
        rawGrant({ id: 'no-type-no-clears', type: undefined, clears: undefined }),
        rawGrant({ id: 'scoped-only', type: undefined, clears: 'five_hour_opus' }),
        rawGrant({ id: 'new-type', type: 'monthly' }),
        rawGrant({ id: '', type: 'weekly' }),
        rawGrant({ id: undefined, type: 'weekly' }),
        rawGrant({ id: 'ok', type: 'weekly' }),
      ]),
    );
    expect(parsed?.grants.map((item) => item.id)).toEqual(['ok']);
  });

  it('is null when every grant is malformed', () => {
    expect(parseUsageResets(rawBlock([{ id: 'a' }, { type: 'full' }]))).toBeNull();
  });

  it('accepts a numeric id and tolerates missing optional fields', () => {
    const parsed = parseUsageResets(rawBlock([{ id: 12, type: 'full' }]));
    expect(parsed?.grants[0]).toEqual({
      id: '12',
      label: null,
      type: 'full',
      resetsLeft: 0,
      resetsTotal: null,
      startsAt: null,
      endsAt: null,
      clears: ['fiveHour', 'sevenDay'],
      clearsScoped: [],
      paused: false,
      usableNow: false,
    });
  });

  it('derives what a grant clears from its type when clears is missing or unrecognized', () => {
    const clears = (type: string, value: unknown) =>
      parseUsageResets(rawBlock([rawGrant({ type, clears: value })]))?.grants[0]?.clears;
    expect(clears('session', undefined)).toEqual(['fiveHour']);
    expect(clears('weekly', null)).toEqual(['sevenDay']);
    expect(clears('full', 42)).toEqual(['fiveHour', 'sevenDay']);
    expect(clears('weekly', 'something else')).toEqual(['sevenDay']);
    expect(clears('weekly', ['unknown', 7, null])).toEqual(['sevenDay']);
  });

  it('understands what a grant clears as a word, a list or "all"', () => {
    const clears = (value: unknown) => parseUsageResets(rawBlock([rawGrant({ type: 'full', clears: value })]))?.grants[0]?.clears;
    expect(clears('seven_day')).toEqual(['sevenDay']);
    expect(clears('weekly')).toEqual(['sevenDay']);
    expect(clears(['five_hour', 'seven_day'])).toEqual(['fiveHour', 'sevenDay']);
    expect(clears('all')).toEqual(['fiveHour', 'sevenDay']);
    expect(clears(['session'])).toEqual(['fiveHour']);
    expect(clears('full_reset')).toEqual(['fiveHour', 'sevenDay']);
    expect(clears(' Five-Hour ')).toEqual(['fiveHour']);
  });

  it('keeps model-scoped windows apart: they never count as the main 7d or 5h window', () => {
    const grant = (value: unknown, type = 'weekly') => parseUsageResets(rawBlock([rawGrant({ type, clears: value })]))?.grants[0];
    expect(grant(['seven_day_opus'])).toMatchObject({ clears: [], clearsScoped: ['seven_day_opus'] });
    expect(grant(['seven_day_sonnet', 'seven_day'])).toMatchObject({ clears: ['sevenDay'], clearsScoped: ['seven_day_sonnet'] });
    expect(grant('seven_day_overage_included')).toMatchObject({ clears: [], clearsScoped: ['seven_day_overage_included'] });
    expect(grant('weekly_scoped')).toMatchObject({ clears: [], clearsScoped: ['weekly_scoped'] });
    expect(grant(['seven_day_opus', 'seven_day_opus'])?.clearsScoped).toEqual(['seven_day_opus']);
  });

  it('a grant without type gets it from what it clears', () => {
    const typeOf = (value: unknown) => parseUsageResets(rawBlock([rawGrant({ type: undefined, clears: value })]))?.grants[0];
    expect(typeOf('five_hour')).toMatchObject({ type: 'session', clears: ['fiveHour'] });
    expect(typeOf('seven_day')).toMatchObject({ type: 'weekly', clears: ['sevenDay'] });
    expect(typeOf(['five_hour', 'seven_day'])).toMatchObject({ type: 'full', clears: ['fiveHour', 'sevenDay'] });
    expect(typeOf('all')).toMatchObject({ type: 'full' });
    expect(parseUsageResets(rawBlock([rawGrant({ type: null, clears: 'session' })]))?.grants[0]?.type).toBe('session');
  });

  it('a grant without type and without usable clears is dropped', () => {
    for (const clears of [undefined, null, 'whatever', [], 'five_hour_opus']) {
      expect(parseUsageResets(rawBlock([rawGrant({ type: undefined, clears })]))).toBeNull();
    }
  });

  it('a grant without type and with only weekly model-scoped windows is kept as a weekly grant that clears no main window', () => {
    for (const clears of ['seven_day_opus', ['weekly_scoped'], ['seven_day_sonnet', 'five_hour_opus']]) {
      expect(parseUsageResets(rawBlock([rawGrant({ type: undefined, clears })]))?.grants[0]).toMatchObject({ type: 'weekly', clears: [] });
    }
  });

  it('a grant with an unrecognized type is still skipped', () => {
    expect(parseUsageResets(rawBlock([rawGrant({ type: 'monthly', clears: 'five_hour' })]))).toBeNull();
  });

  it('only a boolean true counts for paused and usable_now; counts are whole and not negative', () => {
    const parsed = parseUsageResets(
      rawBlock([rawGrant({ paused: 'yes', usable_now: 1, resets_left: -3, resets_total: 2.9 })]),
    )?.grants[0];
    expect(parsed).toMatchObject({ paused: false, usableNow: false, resetsLeft: 0, resetsTotal: 2 });
  });

  it('reads exhausted windows, ignoring junk', () => {
    expect(parseUsageResets(rawBlock([rawGrant()], { exhausted: ['seven_day', 3, null, 'five_hour'] }))?.exhausted).toEqual([
      'fiveHour',
      'sevenDay',
    ]);
    expect(parseUsageResets(rawBlock([rawGrant()], { exhausted: 'x' }))?.exhausted).toEqual([]);
  });

  it('a model-scoped exhausted window is kept by name and does not mark the main 7d as blocked', () => {
    const parsed = parseUsageResets(rawBlock([rawGrant()], { exhausted: ['seven_day_opus'] }));
    expect(parsed?.exhausted).toEqual([]);
    expect(parsed?.exhaustedScoped).toEqual(['seven_day_opus']);
    expect(blockedWindows(snapshot(10, 10), parsed!).size).toBe(0);
  });
});

describe('totals and usability', () => {
  it('sums the resets left of the grants that have not expired', () => {
    const all = resets([
      grant({ id: 'a', resetsLeft: 2 }),
      grant({ id: 'b', resetsLeft: 1, endsAt: null }),
      grant({ id: 'old', resetsLeft: 5, endsAt: NOW - HOUR_MS }),
      grant({ id: 'edge', resetsLeft: 7, endsAt: NOW }),
    ]);
    expect(totalResetsLeft(all, NOW)).toBe(3);
    expect(liveGrants(all, NOW).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('a grant is usable only when the API says so, it is not paused, has uses left and has not expired', () => {
    expect(isGrantUsable(grant(), NOW)).toBe(true);
    expect(isGrantUsable(grant({ usableNow: false }), NOW)).toBe(false);
    expect(isGrantUsable(grant({ paused: true }), NOW)).toBe(false);
    expect(isGrantUsable(grant({ resetsLeft: 0 }), NOW)).toBe(false);
    expect(isGrantUsable(grant({ endsAt: NOW - 1 }), NOW)).toBe(false);
    expect(isGrantUsable(grant({ endsAt: null }), NOW)).toBe(true);
  });
});

describe('blockedWindows', () => {
  it('a window at 100% or more is blocked', () => {
    expect([...blockedWindows(snapshot(100, 40), resets([grant()]))]).toEqual(['fiveHour']);
    expect([...blockedWindows(snapshot(30, 120), resets([grant()]))]).toEqual(['sevenDay']);
    expect(blockedWindows(snapshot(99.9, 40), resets([grant()])).size).toBe(0);
  });

  it('adds the windows the API lists as exhausted', () => {
    const blocked = blockedWindows(snapshot(10, 10), resets([grant()], { exhausted: ['sevenDay'] }));
    expect([...blocked]).toEqual(['sevenDay']);
  });

  it('at_limit with no way to tell which window blocks means both', () => {
    const blocked = blockedWindows(snapshot(10, 10), resets([grant()], { atLimit: true }));
    expect([...blocked].sort()).toEqual(['fiveHour', 'sevenDay']);
  });

  it('a snapshot without windows blocks nothing', () => {
    expect(blockedWindows({ fiveHour: null, sevenDay: null }, resets([grant()])).size).toBe(0);
  });
});

describe('recommendedGrant', () => {
  const session = (id: string, endsAt: number | null, extra: Partial<ResetGrant> = {}) =>
    grant({ id, type: 'session', clears: ['fiveHour'], endsAt, ...extra });
  const weekly = (id: string, endsAt: number | null, extra: Partial<ResetGrant> = {}) =>
    grant({ id, type: 'weekly', clears: ['sevenDay'], endsAt, ...extra });
  const full = (id: string, endsAt: number | null, extra: Partial<ResetGrant> = {}) =>
    grant({ id, type: 'full', clears: ['fiveHour', 'sevenDay'], endsAt, ...extra });

  it('with the 5h window blocked, picks the usable grant that clears it and expires first', () => {
    const all = resets([session('late', NOW + 5 * DAY_MS), session('soon', NOW + DAY_MS), weekly('weekly', NOW + HOUR_MS)]);
    expect(recommendedGrant(all, snapshot(100, 20), NOW)?.id).toBe('soon');
  });

  it('with the 7d window blocked, only grants that clear it count', () => {
    const all = resets([session('session', NOW + HOUR_MS), weekly('weekly', NOW + 3 * DAY_MS), full('full', NOW + 9 * DAY_MS)]);
    expect(recommendedGrant(all, snapshot(20, 100), NOW)?.id).toBe('weekly');
  });

  it('a full reset wins when it expires first, since it clears the blocked window too', () => {
    const all = resets([weekly('weekly', NOW + 4 * DAY_MS), full('full', NOW + DAY_MS)]);
    expect(recommendedGrant(all, snapshot(20, 100), NOW)?.id).toBe('full');
  });

  it('on a tie in expiry, prefers the grant that clears less, so a full reset is not wasted', () => {
    const all = resets([full('full', NOW + DAY_MS), session('session', NOW + DAY_MS)]);
    expect(recommendedGrant(all, snapshot(100, 20), NOW)?.id).toBe('session');
  });

  it('a grant that never expires comes after any that does', () => {
    const all = resets([session('never', null), session('dated', NOW + 30 * DAY_MS)]);
    expect(recommendedGrant(all, snapshot(100, 0), NOW)?.id).toBe('dated');
    expect(recommendedGrant(resets([session('never', null)]), snapshot(100, 0), NOW)?.id).toBe('never');
  });

  it('skips grants that are not usable now: paused, empty, expired or flagged unusable', () => {
    const all = resets([
      session('paused', NOW + HOUR_MS, { paused: true }),
      session('empty', NOW + HOUR_MS, { resetsLeft: 0 }),
      session('expired', NOW - HOUR_MS),
      session('later', NOW + HOUR_MS, { usableNow: false }),
      session('ok', NOW + 2 * DAY_MS),
    ]);
    expect(recommendedGrant(all, snapshot(100, 0), NOW)?.id).toBe('ok');
  });

  it('is null when no usable grant clears a blocked window', () => {
    expect(recommendedGrant(resets([weekly('weekly', NOW + DAY_MS)]), snapshot(100, 20), NOW)).toBeNull();
    expect(recommendedGrant(resets([session('later', NOW + DAY_MS, { usableNow: false })]), snapshot(100, 20), NOW)).toBeNull();
  });

  it('is null when the user is not at a limit, however many usable grants exist', () => {
    const all = resets([session('a', NOW + HOUR_MS), weekly('b', NOW + HOUR_MS), full('c', NOW + HOUR_MS)]);
    expect(recommendedGrant(all, snapshot(99, 99), NOW)).toBeNull();
  });

  it('uses the exhausted list and at_limit from the API when the snapshot is below the limit', () => {
    const all = [session('session', NOW + 2 * DAY_MS), weekly('weekly', NOW + DAY_MS)];
    expect(recommendedGrant(resets(all, { exhausted: ['fiveHour'] }), snapshot(50, 50), NOW)?.id).toBe('session');
    expect(recommendedGrant(resets(all, { atLimit: true }), snapshot(50, 50), NOW)?.id).toBe('weekly');
  });

  it('at_limit with only a model-scoped exhaustion recommends no main-window grant', () => {
    const all = resets([session('session', NOW + HOUR_MS), weekly('weekly', NOW + HOUR_MS), full('full', NOW + HOUR_MS)], {
      atLimit: true,
      exhaustedScoped: ['seven_day_opus'],
    });
    expect([...blockedWindows(snapshot(20, 30), all)]).toEqual([]);
    expect(recommendedGrant(all, snapshot(20, 30), NOW)).toBeNull();
  });

  it('a grant with a matching model-scoped clears is recommended for that scoped exhaustion, never a full one', () => {
    const opus = grant({ id: 'opus', type: 'weekly', clears: [], clearsScoped: ['seven_day_opus'], endsAt: NOW + 3 * DAY_MS });
    const sonnet = grant({ id: 'sonnet', type: 'weekly', clears: [], clearsScoped: ['seven_day_sonnet'], endsAt: NOW + HOUR_MS });
    const all = resets([sonnet, full('full', NOW + HOUR_MS), opus], { atLimit: true, exhaustedScoped: ['seven_day_opus'] });
    expect(recommendedGrant(all, snapshot(20, 30), NOW)?.id).toBe('opus');
  });

  it('with a main window and a scoped one blocked, the grant that covers both comes first', () => {
    const opus = grant({ id: 'opus', type: 'weekly', clears: [], clearsScoped: ['seven_day_opus'], endsAt: NOW + HOUR_MS });
    const both = grant({ id: 'both', type: 'weekly', clears: ['sevenDay'], clearsScoped: ['seven_day_opus'], endsAt: NOW + 5 * DAY_MS });
    const all = resets([opus, weekly('weekly', NOW + 2 * HOUR_MS), both], { exhaustedScoped: ['seven_day_opus'] });
    expect(recommendedGrant(all, snapshot(20, 100), NOW)?.id).toBe('both');
  });

  it('the "both windows" fallback of at_limit applies only when exhausted is empty', () => {
    expect([...blockedWindows(snapshot(10, 10), resets([grant()], { atLimit: true }))].sort()).toEqual(['fiveHour', 'sevenDay']);
    expect(blockedWindows(snapshot(10, 10), resets([grant()], { atLimit: true, exhaustedScoped: ['seven_day_opus'] })).size).toBe(0);
    expect([...blockedWindows(snapshot(10, 10), resets([grant()], { atLimit: true, exhausted: ['fiveHour'] }))]).toEqual(['fiveHour']);
  });

  it('with both windows blocked, a grant that clears both beats an earlier one that clears only one', () => {
    const all = resets([session('session', NOW + HOUR_MS), weekly('weekly', NOW + 2 * HOUR_MS), full('full', NOW + 5 * DAY_MS)]);
    expect(recommendedGrant(all, snapshot(100, 100), NOW)?.id).toBe('full');
  });

  it('with both windows blocked and no grant that clears both, still recommends the one that expires first', () => {
    const all = resets([session('late', NOW + 3 * DAY_MS), weekly('soon', NOW + DAY_MS)]);
    expect(recommendedGrant(all, snapshot(100, 100), NOW)?.id).toBe('soon');
  });

  it('among grants that clear all the blocked windows, the earliest expiry wins, then the one that clears fewer', () => {
    const all = resets([full('b', NOW + 4 * DAY_MS), full('a', NOW + 2 * DAY_MS), weekly('w', NOW + HOUR_MS)]);
    expect(recommendedGrant(all, snapshot(100, 100), NOW)?.id).toBe('a');
    const tie = resets([full('full', NOW + DAY_MS), weekly('weekly', NOW + DAY_MS)]);
    expect(recommendedGrant(tie, snapshot(20, 100), NOW)?.id).toBe('weekly');
  });

  it('a grant that clears only a model-scoped window is not recommended for the main 7d', () => {
    const scoped = grant({ id: 'opus', type: 'weekly', clears: [], clearsScoped: ['seven_day_opus'], endsAt: NOW + HOUR_MS });
    const all = resets([scoped, weekly('weekly', NOW + 5 * DAY_MS)]);
    expect(recommendedGrant(all, snapshot(20, 100), NOW)?.id).toBe('weekly');
    expect(recommendedGrant(resets([scoped]), snapshot(20, 100), NOW)).toBeNull();
  });

  it('does not reorder the grants it receives', () => {
    const all = resets([session('b', NOW + 2 * DAY_MS), session('a', NOW + DAY_MS)]);
    recommendedGrant(all, snapshot(100, 0), NOW);
    expect(all.grants.map((item) => item.id)).toEqual(['b', 'a']);
  });
});
