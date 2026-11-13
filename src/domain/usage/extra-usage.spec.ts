import { describe, expect, it } from 'vitest';
import { parseExtraUsage } from './extra-usage';

const extra = (overrides: Record<string, unknown> = {}) => ({
  extra_usage: {
    is_enabled: true,
    monthly_limit: 10_000,
    used_credits: 2_500.5,
    utilization: 25,
    currency: 'USD',
    decimal_places: 2,
    disabled_reason: null,
    ...overrides,
  },
});

describe('parseExtraUsage', () => {
  it('reads the enabled state, the amounts in minor units, the currency and the percent', () => {
    expect(parseExtraUsage(extra())).toEqual({
      enabled: true,
      usedMinor: 2_500.5,
      limitMinor: 10_000,
      percent: 25,
      currency: 'USD',
      exponent: 2,
    });
  });

  it('derives the percent from used and limit when utilization is null or missing', () => {
    expect(parseExtraUsage(extra({ utilization: null }))?.percent).toBeCloseTo(25.005, 6);
    expect(parseExtraUsage(extra({ utilization: undefined, used_credits: 5_000 }))?.percent).toBe(50);
  });

  it('has no percent when there is no limit and no reported utilization', () => {
    expect(parseExtraUsage(extra({ utilization: null, monthly_limit: null }))).toMatchObject({ limitMinor: null, percent: null });
    expect(parseExtraUsage(extra({ utilization: null, monthly_limit: 0 }))).toMatchObject({ limitMinor: null, percent: null });
  });

  it('an account with it off still returns the block, flagged as disabled', () => {
    expect(parseExtraUsage(extra({ is_enabled: false, used_credits: null, monthly_limit: null, utilization: null }))).toEqual({
      enabled: false,
      usedMinor: 0,
      limitMinor: null,
      percent: null,
      currency: 'USD',
      exponent: 2,
    });
  });

  it('only a boolean true counts as enabled', () => {
    for (const is_enabled of ['true', 1, null, undefined]) {
      expect(parseExtraUsage(extra({ is_enabled }))?.enabled).toBe(false);
    }
  });

  it('uses the decimal places of the account and falls back to 2 when invalid', () => {
    expect(parseExtraUsage(extra({ decimal_places: 0, currency: 'jpy' }))).toMatchObject({ exponent: 0, currency: 'JPY' });
    expect(parseExtraUsage(extra({ decimal_places: 3 }))?.exponent).toBe(3);
    for (const decimal_places of [-1, 1.5, 9, 'x', null, undefined]) {
      expect(parseExtraUsage(extra({ decimal_places }))?.exponent).toBe(2);
    }
  });

  it('is null when the block is absent, null, not an object, or without a usable currency', () => {
    expect(parseExtraUsage({})).toBeNull();
    expect(parseExtraUsage({ extra_usage: null })).toBeNull();
    expect(parseExtraUsage({ extra_usage: 'x' })).toBeNull();
    expect(parseExtraUsage({ extra_usage: [] })).toBeNull();
    for (const currency of [null, undefined, '', 'US', 'DOLLAR', 'U$D', 7]) {
      expect(parseExtraUsage(extra({ currency }))).toBeNull();
    }
  });

  it('clamps negative values and ignores junk amounts', () => {
    expect(parseExtraUsage(extra({ used_credits: -10, utilization: -3 }))).toMatchObject({ usedMinor: 0, percent: 0 });
    expect(parseExtraUsage(extra({ used_credits: 'abc', monthly_limit: 'abc', utilization: 'abc' }))).toMatchObject({
      usedMinor: 0,
      limitMinor: null,
      percent: null,
    });
  });
});
