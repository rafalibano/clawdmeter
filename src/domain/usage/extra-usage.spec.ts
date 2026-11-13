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
      limitReached: false,
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
  });

  it('a limit of 0 is a real limit, not "no limit", and gives no percent since it cannot be divided', () => {
    expect(parseExtraUsage(extra({ utilization: null, monthly_limit: 0, used_credits: 300 }))).toMatchObject({ limitMinor: 0, percent: null });
    expect(parseExtraUsage(extra({ monthly_limit: 0, utilization: 40 }))).toMatchObject({ limitMinor: 0, percent: 40 });
  });

  it('only a missing or null monthly limit means no limit', () => {
    expect(parseExtraUsage(extra({ utilization: null, monthly_limit: undefined }))?.limitMinor).toBeNull();
    expect(parseExtraUsage(extra({ utilization: null, monthly_limit: null }))?.limitMinor).toBeNull();
    expect(parseExtraUsage(extra({ monthly_limit: 'abc' }))?.limitMinor).toBeNull();
  });

  it('uses utilization only when it is a finite number from 0 to 100, otherwise derives from used and limit', () => {
    const percent = (utilization: unknown) => parseExtraUsage(extra({ utilization, used_credits: 5_000 }))?.percent;
    expect(percent(0)).toBe(0);
    expect(percent(100)).toBe(100);
    expect(percent(33.3)).toBe(33.3);
    for (const unknown of [null, undefined, -1, 100.5, 250, Number.NaN, Number.POSITIVE_INFINITY, 'abc']) {
      expect(percent(unknown)).toBe(50);
    }
  });

  it('flags a reached spend limit', () => {
    expect(parseExtraUsage(extra({ spend_limit_reached: true }))).toMatchObject({ enabled: true, limitReached: true });
    for (const spend_limit_reached of [false, null, undefined, 'true', 1]) {
      expect(parseExtraUsage(extra({ spend_limit_reached }))?.limitReached).toBe(false);
    }
  });

  it('a user who turned it off is not enabled, whatever is_enabled says', () => {
    expect(parseExtraUsage(extra({ is_enabled: true, user_disabled: true }))?.enabled).toBe(false);
    expect(parseExtraUsage(extra({ is_enabled: true, user_disabled: false }))?.enabled).toBe(true);
    expect(parseExtraUsage(extra({ is_enabled: true, user_disabled: null }))?.enabled).toBe(true);
    expect(parseExtraUsage(extra({ is_enabled: false, user_disabled: false }))?.enabled).toBe(false);
  });

  it('an account with it off still returns the block, flagged as disabled', () => {
    expect(parseExtraUsage(extra({ is_enabled: false, used_credits: null, monthly_limit: null, utilization: null }))).toEqual({
      enabled: false,
      limitReached: false,
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
