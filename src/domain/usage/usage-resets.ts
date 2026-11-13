import { EXHAUSTION_LEVEL } from './forecast';
import { asNumber, asText, asTimestamp, isRecord } from './payload';
import type { UsageSnapshot } from './usage-snapshot';
import type { UsageWindowKind } from './usage-window';

export type ResetGrantType = 'session' | 'weekly' | 'full';

export const RESET_GRANT_TYPES: readonly ResetGrantType[] = ['session', 'weekly', 'full'];

export interface ResetGrant {
  id: string;
  label: string | null;
  type: ResetGrantType;
  resetsLeft: number;
  resetsTotal: number | null;
  startsAt: number | null;
  endsAt: number | null;
  clears: readonly UsageWindowKind[];
  paused: boolean;
  usableNow: boolean;
}

export interface UsageResets {
  atLimit: boolean;
  exhausted: readonly UsageWindowKind[];
  grants: readonly ResetGrant[];
}

const ALL_WINDOWS: readonly UsageWindowKind[] = ['fiveHour', 'sevenDay'];

const CLEARS_BY_TYPE: Record<ResetGrantType, readonly UsageWindowKind[]> = {
  session: ['fiveHour'],
  weekly: ['sevenDay'],
  full: ALL_WINDOWS,
};

function windowsIn(value: unknown): UsageWindowKind[] {
  const tokens = (Array.isArray(value) ? value : [value]).flatMap((item) => {
    const text = asText(item);
    return text === null ? [] : [text.toLowerCase()];
  });
  const found = new Set<UsageWindowKind>();
  for (const token of tokens) {
    if (/\b(all|both|full)\b/.test(token)) ALL_WINDOWS.forEach((kind) => found.add(kind));
    if (/five|5h|session/.test(token)) found.add('fiveHour');
    if (/seven|7d|week/.test(token)) found.add('sevenDay');
  }
  return ALL_WINDOWS.filter((kind) => found.has(kind));
}

function readId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return asText(value);
}

function readGrant(raw: unknown): ResetGrant | null {
  if (!isRecord(raw)) return null;
  const id = readId(raw['id']);
  const type = RESET_GRANT_TYPES.find((candidate) => candidate === raw['type']);
  if (id === null || type === undefined) return null;
  const declared = windowsIn(raw['clears']);
  const total = asNumber(raw['resets_total']);
  return {
    id,
    label: asText(raw['label']),
    type,
    resetsLeft: Math.max(0, Math.floor(asNumber(raw['resets_left']) ?? 0)),
    resetsTotal: total === null ? null : Math.max(0, Math.floor(total)),
    startsAt: asTimestamp(raw['starts_at']),
    endsAt: asTimestamp(raw['ends_at']),
    clears: declared.length > 0 ? declared : CLEARS_BY_TYPE[type],
    paused: raw['paused'] === true,
    usableNow: raw['usable_now'] === true,
  };
}

export function parseUsageResets(raw: unknown): UsageResets | null {
  if (!isRecord(raw) || raw['eligible'] !== true) return null;
  const rows = Array.isArray(raw['grants']) ? raw['grants'] : [];
  const grants = rows.flatMap((row) => {
    const grant = readGrant(row);
    return grant === null ? [] : [grant];
  });
  if (grants.length === 0) return null;
  return { atLimit: raw['at_limit'] === true, exhausted: windowsIn(raw['exhausted']), grants };
}

export function isGrantExpired(grant: ResetGrant, now: number): boolean {
  return grant.endsAt !== null && grant.endsAt <= now;
}

export function liveGrants(resets: UsageResets, now: number): ResetGrant[] {
  return resets.grants.filter((grant) => !isGrantExpired(grant, now));
}

export function totalResetsLeft(resets: UsageResets, now: number): number {
  return liveGrants(resets, now).reduce((total, grant) => total + grant.resetsLeft, 0);
}

export function isGrantUsable(grant: ResetGrant, now: number): boolean {
  return grant.usableNow && !grant.paused && grant.resetsLeft > 0 && !isGrantExpired(grant, now);
}

export function blockedWindows(snapshot: UsageSnapshot, resets: UsageResets): Set<UsageWindowKind> {
  const blocked = new Set<UsageWindowKind>(resets.exhausted);
  for (const kind of ALL_WINDOWS) {
    if ((snapshot[kind]?.utilization ?? 0) >= EXHAUSTION_LEVEL) blocked.add(kind);
  }
  if (blocked.size === 0 && resets.atLimit) ALL_WINDOWS.forEach((kind) => blocked.add(kind));
  return blocked;
}

function expiresBefore(a: ResetGrant, b: ResetGrant): number {
  if (a.endsAt === b.endsAt) return a.clears.length - b.clears.length;
  if (a.endsAt === null) return 1;
  if (b.endsAt === null) return -1;
  return a.endsAt - b.endsAt;
}

export function recommendedGrant(
  resets: UsageResets,
  snapshot: UsageSnapshot,
  now: number,
): ResetGrant | null {
  const blocked = blockedWindows(snapshot, resets);
  // Not at a limit means nothing to clear, so no grant is recommended.
  if (blocked.size === 0) return null;
  const candidates = resets.grants.filter(
    (grant) => isGrantUsable(grant, now) && grant.clears.some((kind) => blocked.has(kind)),
  );
  return [...candidates].sort(expiresBefore)[0] ?? null;
}
