import type { UsageResetsData } from '../../../application/use-cases';
import {
  USAGE_WINDOWS,
  isGrantUsable,
  liveGrants,
  recommendedGrant,
  totalResetsLeft,
  type ExtraUsage,
  type ResetGrant,
  type UsageBlockSettings,
  type UsageSnapshot,
} from '../../../domain/usage';
import type { Localizer } from '../../i18n';
import { resetText } from './usage-view';

export interface ModelLimitView {
  name: string;
  percent: string;
  fill: number;
  reset: string;
}

export interface ExtraUsageView {
  enabled: boolean;
  state: string;
  amounts: string | null;
  percent: string | null;
  fill: number | null;
}

export interface ResetGrantView {
  id: string;
  title: string;
  clears: string;
  uses: string;
  expires: string;
  availability: string;
  usable: boolean;
  recommended: boolean;
}

export interface ResetsView {
  total: string;
  grants: ResetGrantView[];
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export function toModelLimitViews(snapshot: UsageSnapshot, now: number, l: Localizer): ModelLimitView[] {
  return (snapshot.modelLimits ?? []).map((limit) => ({
    name: limit.name,
    percent: `${Math.round(limit.utilization)}%`,
    fill: clampPercent(limit.utilization),
    reset: resetText(limit.resetsAt, now, l),
  }));
}

export function toExtraUsageView(extra: ExtraUsage | null | undefined, l: Localizer): ExtraUsageView | null {
  if (extra === null || extra === undefined) return null;
  const state = l.t(!extra.enabled ? 'usage.extra.off' : extra.limitReached ? 'usage.extra.limitReached' : 'usage.extra.on');
  if (!extra.enabled) return { enabled: false, state, amounts: null, percent: null, fill: null };
  const used = l.money(extra.usedMinor, extra.currency, extra.exponent);
  const amounts =
    extra.limitMinor === null
      ? l.t('usage.extra.noLimit', { used })
      : l.t('usage.extra.of', { used, limit: l.money(extra.limitMinor, extra.currency, extra.exponent) });
  return {
    enabled: true,
    state,
    amounts,
    percent: extra.percent === null ? null : `${Math.round(extra.percent)}%`,
    fill: extra.percent === null ? null : clampPercent(extra.percent),
  };
}

const SCOPED_WINDOW = /^(five_hour|seven_day|weekly)_(.+)$/;

function humanize(token: string): string {
  const words = token.replace(/_+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function scopedWindowLabel(token: string): string {
  const match = SCOPED_WINDOW.exec(token);
  if (match === null) return humanize(token);
  const kind = match[1] === 'five_hour' ? 'fiveHour' : 'sevenDay';
  const window = USAGE_WINDOWS.find((candidate) => candidate.kind === kind)?.label ?? '';
  return `${humanize(match[2]!)} ${window}`.trim();
}

function clearsText(grant: ResetGrant, l: Localizer): string {
  const main = USAGE_WINDOWS.filter(({ kind }) => grant.clears.includes(kind)).map(({ label }) => label);
  return l.t('usage.resets.clears', { windows: [...main, ...grant.clearsScoped.map(scopedWindowLabel)].join(' + ') });
}

function availabilityText(grant: ResetGrant, now: number, l: Localizer): string {
  if (grant.paused) return l.t('usage.resets.paused');
  return l.t(isGrantUsable(grant, now) ? 'usage.resets.usable' : 'usage.resets.notUsable');
}

function usesText(grant: ResetGrant, l: Localizer): string {
  return grant.resetsTotal === null
    ? l.plural('usage.resets.left', grant.resetsLeft, { left: grant.resetsLeft })
    : l.plural('usage.resets.leftOf', grant.resetsLeft, { left: grant.resetsLeft, total: grant.resetsTotal });
}

function grantView(grant: ResetGrant, recommendedId: string | null, now: number, l: Localizer): ResetGrantView {
  return {
    id: grant.id,
    title: grant.label ?? l.t(`usage.resets.type.${grant.type}`),
    clears: clearsText(grant, l),
    uses: usesText(grant, l),
    expires: grant.endsAt === null ? l.t('usage.resets.noExpiry') : l.t('usage.resets.expires', { span: l.span(grant.endsAt - now) }),
    availability: availabilityText(grant, now, l),
    usable: isGrantUsable(grant, now),
    recommended: grant.id === recommendedId,
  };
}

export function toResetsView(
  data: UsageResetsData | null,
  snapshot: UsageSnapshot,
  now: number,
  l: Localizer,
): ResetsView | null {
  if (data?.resets == null) return null;
  const grants = liveGrants(data.resets, now);
  if (grants.length === 0) return null;
  const recommendedId = recommendedGrant(data.resets, snapshot, now)?.id ?? null;
  return {
    total: l.plural('usage.resets.total', totalResetsLeft(data.resets, now), { count: totalResetsLeft(data.resets, now) }),
    grants: grants.map((grant) => grantView(grant, recommendedId, now, l)),
  };
}

export interface UsageBlocksInput {
  snapshot: UsageSnapshot;
  at: number;
  now: number;
  blocks: UsageBlockSettings;
  resets: UsageResetsData | null;
  activeAccountId: string | null;
}

export interface UsageBlocksView {
  modelLimits: ModelLimitView[] | null;
  extraUsage: ExtraUsageView | null;
  resets: ResetsView | null;
}

export function toUsageBlocksView(input: UsageBlocksInput, l: Localizer): UsageBlocksView {
  const { snapshot, blocks } = input;
  const limits = blocks.modelLimits ? toModelLimitViews(snapshot, input.at, l) : [];
  const resetsData = input.resets?.accountId === input.activeAccountId ? input.resets : null;
  return {
    modelLimits: limits.length === 0 ? null : limits,
    extraUsage: blocks.extraUsage ? toExtraUsageView(snapshot.extraUsage, l) : null,
    resets: blocks.resets ? toResetsView(resetsData, snapshot, input.now, l) : null,
  };
}
