import { asNumber, asText, isRecord } from './payload';

export interface ExtraUsage {
  enabled: boolean;
  usedMinor: number;
  limitMinor: number | null;
  percent: number | null;
  currency: string;
  exponent: number;
}

const DEFAULT_EXPONENT = 2;
const MAX_EXPONENT = 6;
const CURRENCY_CODE = /^[A-Za-z]{3}$/;

function readExponent(value: unknown): number {
  const exponent = asNumber(value);
  return exponent !== null && Number.isInteger(exponent) && exponent >= 0 && exponent <= MAX_EXPONENT
    ? exponent
    : DEFAULT_EXPONENT;
}

export function parseExtraUsage(record: Record<string, unknown>): ExtraUsage | null {
  const raw = record['extra_usage'];
  if (!isRecord(raw)) return null;
  const currency = asText(raw['currency']);
  if (currency === null || !CURRENCY_CODE.test(currency)) return null;
  const usedMinor = Math.max(0, asNumber(raw['used_credits']) ?? 0);
  const limit = asNumber(raw['monthly_limit']);
  const limitMinor = limit !== null && limit > 0 ? limit : null;
  const reported = asNumber(raw['utilization']);
  const derived = limitMinor === null ? null : (usedMinor / limitMinor) * 100;
  const percent = reported ?? derived;
  return {
    enabled: raw['is_enabled'] === true,
    usedMinor,
    limitMinor,
    percent: percent === null ? null : Math.max(0, percent),
    currency: currency.toUpperCase(),
    exponent: readExponent(raw['decimal_places']),
  };
}
