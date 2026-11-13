import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from '../../../domain/time';
import type { ExtraUsage, ResetGrant, UsageResets, UsageSnapshot } from '../../../domain/usage';
import { Localizer } from '../../i18n';
import { toExtraUsageView, toModelLimitViews, toResetsView, toUsageBlocksView } from './usage-blocks-view';

const EN = new Localizer('en');
const PT = new Localizer('pt-BR');
const NOW = new Date(2026, 10, 13, 12, 0).getTime();

const snapshot = (overrides: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  fiveHour: { utilization: 20, resetsAt: NOW + HOUR_MS },
  sevenDay: { utilization: 30, resetsAt: NOW + 3 * DAY_MS },
  ...overrides,
});

const grant = (overrides: Partial<ResetGrant> = {}): ResetGrant => ({
  id: 'g1',
  label: null,
  type: 'session',
  resetsLeft: 2,
  resetsTotal: 3,
  startsAt: null,
  endsAt: NOW + 2 * DAY_MS,
  clears: ['fiveHour'],
  clearsScoped: [],
  paused: false,
  usableNow: true,
  ...overrides,
});

const resets = (grants: ResetGrant[], overrides: Partial<UsageResets> = {}): UsageResets => ({ atLimit: false, exhausted: [], grants, ...overrides });

const data = (value: UsageResets | null) => ({ accountId: 'account-1', at: NOW, resets: value });

describe('toModelLimitViews', () => {
  it('builds one bar per limit with the name the API sends, the percent and the reset time', () => {
    const views = toModelLimitViews(
      snapshot({
        modelLimits: [
          { name: 'Fable', utilization: 31.6, resetsAt: NOW + 2 * DAY_MS + 3 * HOUR_MS },
          { name: 'Sonnet', utilization: 140, resetsAt: null },
        ],
      }),
      NOW,
      EN,
    );
    expect(views).toEqual([
      { name: 'Fable', percent: '32%', fill: 31.6, reset: 'resets in 2d3h' },
      { name: 'Sonnet', percent: '140%', fill: 100, reset: 'no active window' },
    ]);
  });

  it('is empty for a snapshot without model limits, whether the field is missing or empty', () => {
    expect(toModelLimitViews(snapshot(), NOW, EN)).toEqual([]);
    expect(toModelLimitViews(snapshot({ modelLimits: [] }), NOW, EN)).toEqual([]);
  });

  it('writes the reset in the current language', () => {
    const [view] = toModelLimitViews(snapshot({ modelLimits: [{ name: 'Fable', utilization: 5, resetsAt: NOW + HOUR_MS }] }), NOW, PT);
    expect(view?.reset).toBe('reseta em 1h');
  });
});

describe('toExtraUsageView', () => {
  const extra = (overrides: Partial<ExtraUsage> = {}): ExtraUsage => ({
    enabled: true,
    limitReached: false,
    usedMinor: 4_250,
    limitMinor: 10_000,
    percent: 42.5,
    currency: 'USD',
    exponent: 2,
    ...overrides,
  });

  it('is null when the account sends no extra usage', () => {
    expect(toExtraUsageView(null, EN)).toBeNull();
    expect(toExtraUsageView(undefined, EN)).toBeNull();
  });

  it('shows on, spent and limit in the account currency (minor units) and the percent', () => {
    expect(toExtraUsageView(extra(), EN)).toEqual({
      enabled: true,
      state: 'On',
      amounts: '$42.50 of $100.00',
      percent: '43%',
      fill: 42.5,
    });
  });

  it('formats the money by the language, keeping the currency of the account', () => {
    expect(toExtraUsageView(extra({ currency: 'BRL' }), PT)?.amounts).toMatch(/^R\$\s42,50 de R\$\s100,00$/);
    expect(toExtraUsageView(extra({ currency: 'MXN' }), new Localizer('es-MX'))?.amounts).toBe('$42.50 de $100.00');
    expect(toExtraUsageView(extra({ currency: 'EUR' }), EN)?.amounts).toBe('€42.50 of €100.00');
  });

  it('respects the decimal places of the currency', () => {
    expect(toExtraUsageView(extra({ currency: 'JPY', exponent: 0, usedMinor: 4_250, limitMinor: 10_000 }), EN)?.amounts).toBe('¥4,250 of ¥10,000');
    expect(toExtraUsageView(extra({ exponent: 3, usedMinor: 4_250, limitMinor: 10_000 }), EN)?.amounts).toBe('$4.250 of $10.000');
  });

  it('says there is no monthly limit and shows no bar when the percent is unknown', () => {
    expect(toExtraUsageView(extra({ limitMinor: null, percent: null }), EN)).toEqual({
      enabled: true,
      state: 'On',
      amounts: '$42.50 · no monthly limit',
      percent: null,
      fill: null,
    });
  });

  it('caps the bar at 100% while keeping the real percent text', () => {
    expect(toExtraUsageView(extra({ usedMinor: 15_000, percent: 150 }), EN)).toMatchObject({ percent: '150%', fill: 100 });
  });

  it('says the limit was reached, still showing what was spent', () => {
    expect(toExtraUsageView(extra({ limitReached: true, usedMinor: 10_000, percent: 100 }), EN)).toEqual({
      enabled: true,
      state: 'Limit reached',
      amounts: '$100.00 of $100.00',
      percent: '100%',
      fill: 100,
    });
    expect(toExtraUsageView(extra({ limitReached: true }), PT)?.state).toBe('Limite atingido');
    expect(toExtraUsageView(extra({ limitReached: true }), new Localizer('es-MX'))?.state).toBe('Límite alcanzado');
  });

  it('a limit of zero is shown as a real limit', () => {
    expect(toExtraUsageView(extra({ limitMinor: 0, usedMinor: 0, percent: null }), EN)).toMatchObject({ amounts: '$0.00 of $0.00', percent: null });
  });

  it('when off, shows only the state', () => {
    expect(toExtraUsageView(extra({ enabled: false }), EN)).toEqual({ enabled: false, state: 'Off', amounts: null, percent: null, fill: null });
    expect(toExtraUsageView(extra({ enabled: false }), PT)?.state).toBe('Desligado');
  });
});

describe('toResetsView', () => {
  it('is null without data, without resets or when every grant has expired', () => {
    expect(toResetsView(null, snapshot(), NOW, EN)).toBeNull();
    expect(toResetsView(data(null), snapshot(), NOW, EN)).toBeNull();
    expect(toResetsView(data(resets([grant({ endsAt: NOW - 1 })])), snapshot(), NOW, EN)).toBeNull();
  });

  it('shows the total left and, per grant, the type, what it clears, uses, expiry and whether it is usable', () => {
    const view = toResetsView(
      data(resets([grant(), grant({ id: 'g2', type: 'full', clears: ['fiveHour', 'sevenDay'], resetsLeft: 1, resetsTotal: null, endsAt: null, usableNow: false })])),
      snapshot(),
      NOW,
      EN,
    );
    expect(view?.total).toBe('3 left');
    expect(view?.grants).toEqual([
      {
        id: 'g1',
        title: 'Session reset',
        clears: 'Clears 5h',
        uses: '2 of 3 left',
        expires: 'expires in 2d',
        availability: 'usable now',
        usable: true,
        recommended: false,
      },
      {
        id: 'g2',
        title: 'Full reset',
        clears: 'Clears 5h + 7d',
        uses: '1 left',
        expires: 'no expiry',
        availability: 'not usable now',
        usable: false,
        recommended: false,
      },
    ]);
  });

  it('uses the label of the grant as the title when the API sends one', () => {
    const view = toResetsView(data(resets([grant({ label: 'Launch gift' })])), snapshot(), NOW, EN);
    expect(view?.grants[0]?.title).toBe('Launch gift');
  });

  it('marks a paused grant as paused and not usable', () => {
    const view = toResetsView(data(resets([grant({ paused: true })])), snapshot(), NOW, EN);
    expect(view?.grants[0]).toMatchObject({ availability: 'paused', usable: false });
  });

  it('leaves out expired grants and does not count their resets', () => {
    const view = toResetsView(data(resets([grant({ id: 'old', resetsLeft: 9, endsAt: NOW - HOUR_MS }), grant({ id: 'live', resetsLeft: 1 })])), snapshot(), NOW, EN);
    expect(view?.grants.map((item) => item.id)).toEqual(['live']);
    expect(view?.total).toBe('1 left');
  });

  it('highlights the grant that clears the blocked window and expires first', () => {
    const grants = [
      grant({ id: 'late', endsAt: NOW + 5 * DAY_MS }),
      grant({ id: 'soon', endsAt: NOW + DAY_MS }),
      grant({ id: 'weekly', type: 'weekly', clears: ['sevenDay'], endsAt: NOW + HOUR_MS }),
    ];
    const blocked = snapshot({ fiveHour: { utilization: 100, resetsAt: NOW + HOUR_MS } });
    const view = toResetsView(data(resets(grants)), blocked, NOW, EN);
    expect(view?.grants.filter((item) => item.recommended).map((item) => item.id)).toEqual(['soon']);
  });

  it('shows a grant that clears only a model-scoped window by that name, not as the main 7d', () => {
    const scoped = grant({ id: 'opus', type: 'weekly', clears: [], clearsScoped: ['seven_day_opus'] });
    const both = grant({ id: 'both', type: 'weekly', clears: ['sevenDay'], clearsScoped: ['seven_day_sonnet'] });
    const view = toResetsView(data(resets([scoped, both])), snapshot(), NOW, EN);
    expect(view?.grants.map((item) => item.clears)).toEqual(['Clears seven_day_opus', 'Clears 7d + seven_day_sonnet']);
  });

  it('does not recommend a model-scoped grant when the main 7d is blocked', () => {
    const scoped = grant({ id: 'opus', type: 'weekly', clears: [], clearsScoped: ['seven_day_opus'], endsAt: NOW + HOUR_MS });
    const weekly = grant({ id: 'weekly', type: 'weekly', clears: ['sevenDay'], endsAt: NOW + 5 * DAY_MS });
    const blocked = snapshot({ sevenDay: { utilization: 100, resetsAt: NOW + DAY_MS } });
    const view = toResetsView(data(resets([scoped, weekly])), blocked, NOW, EN);
    expect(view?.grants.filter((item) => item.recommended).map((item) => item.id)).toEqual(['weekly']);
  });

  it('uses the singular when one is left, in each language', () => {
    const one = data(resets([grant({ resetsLeft: 1, resetsTotal: 1 })]));
    const noTotal = data(resets([grant({ resetsLeft: 1, resetsTotal: null })]));
    expect(toResetsView(one, snapshot(), NOW, EN)).toMatchObject({ total: '1 left' });
    expect(toResetsView(one, snapshot(), NOW, PT)).toMatchObject({ total: '1 restante' });
    expect(toResetsView(one, snapshot(), NOW, new Localizer('es-MX'))).toMatchObject({ total: '1 restante' });
    expect(toResetsView(one, snapshot(), NOW, PT)?.grants[0]?.uses).toBe('1 de 1 restante');
    expect(toResetsView(noTotal, snapshot(), NOW, PT)?.grants[0]?.uses).toBe('1 restante');
    expect(toResetsView(noTotal, snapshot(), NOW, new Localizer('es-MX'))?.grants[0]?.uses).toBe('1 restante');
    expect(toResetsView(noTotal, snapshot(), NOW, EN)?.grants[0]?.uses).toBe('1 left');
  });

  it('uses the plural for zero and several', () => {
    const zero = data(resets([grant({ resetsLeft: 0, resetsTotal: 3 })]));
    expect(toResetsView(zero, snapshot(), NOW, EN)?.total).toBe('0 left');
    expect(toResetsView(zero, snapshot(), NOW, new Localizer('es-MX'))?.total).toBe('0 restantes');
  });

  it('highlights nothing when the user is not at a limit', () => {
    const view = toResetsView(data(resets([grant()])), snapshot(), NOW, EN);
    expect(view?.grants.some((item) => item.recommended)).toBe(false);
  });

  it('writes everything in the current language', () => {
    const view = toResetsView(data(resets([grant()])), snapshot(), NOW, PT);
    expect(view).toMatchObject({ total: '2 restantes' });
    expect(view?.grants[0]).toMatchObject({
      title: 'Reset de sessão',
      clears: 'Limpa 5h',
      uses: '2 de 3 restantes',
      expires: 'expira em 2d',
      availability: 'dá para usar agora',
    });
  });
});

describe('toUsageBlocksView', () => {
  const full = snapshot({
    modelLimits: [{ name: 'Fable', utilization: 10, resetsAt: NOW + DAY_MS }],
    extraUsage: { enabled: true, limitReached: false, usedMinor: 100, limitMinor: 1_000, percent: 10, currency: 'USD', exponent: 2 },
  });
  const input = (overrides: Partial<Parameters<typeof toUsageBlocksView>[0]> = {}) => ({
    snapshot: full,
    at: NOW,
    now: NOW,
    blocks: { modelLimits: true, extraUsage: true, resets: true },
    resets: data(resets([grant()])),
    activeAccountId: 'account-1',
    ...overrides,
  });

  it('shows the three blocks when they are on and the account returns data', () => {
    const view = toUsageBlocksView(input(), EN);
    expect(view.modelLimits?.map((limit) => limit.name)).toEqual(['Fable']);
    expect(view.extraUsage?.state).toBe('On');
    expect(view.resets?.grants).toHaveLength(1);
  });

  it('a block that is off is not built, whatever the data', () => {
    expect(toUsageBlocksView(input({ blocks: { modelLimits: false, extraUsage: true, resets: true } }), EN).modelLimits).toBeNull();
    expect(toUsageBlocksView(input({ blocks: { modelLimits: true, extraUsage: false, resets: true } }), EN).extraUsage).toBeNull();
    expect(toUsageBlocksView(input({ blocks: { modelLimits: true, extraUsage: true, resets: false } }), EN).resets).toBeNull();
  });

  it('a block that is on but has no data from the account is null, with no error', () => {
    const view = toUsageBlocksView(input({ snapshot: snapshot(), resets: null }), EN);
    expect(view).toEqual({ modelLimits: null, extraUsage: null, resets: null });
  });

  it('resets read for another account are not shown', () => {
    expect(toUsageBlocksView(input({ activeAccountId: 'account-2' }), EN).resets).toBeNull();
    expect(toUsageBlocksView(input({ activeAccountId: null }), EN).resets).toBeNull();
  });

  it('a failed resets read (no data) leaves the other blocks untouched', () => {
    const view = toUsageBlocksView(input({ resets: null }), EN);
    expect(view.resets).toBeNull();
    expect(view.modelLimits).not.toBeNull();
    expect(view.extraUsage).not.toBeNull();
  });
});
