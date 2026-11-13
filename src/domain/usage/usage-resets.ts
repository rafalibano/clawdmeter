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
  clearsScoped: readonly string[];
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

const FIVE_HOUR_TOKENS = ['five_hour', 'session'];
const SEVEN_DAY_TOKENS = ['seven_day', 'weekly'];
const BOTH_TOKENS = ['all', 'both', 'full', 'full_reset'];
const SCOPED_TOKEN = /^(five_hour|seven_day|weekly)_[a-z0-9_]+$/;

interface ReadWindows {
  windows: UsageWindowKind[];
  scoped: string[];
}

function readWindows(value: unknown): ReadWindows {
  const found = new Set<UsageWindowKind>();
  const scoped: string[] = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    const token = asText(item)?.toLowerCase().replace(/[\s-]+/g, '_');
    if (token === undefined || token === null) continue;
    if (BOTH_TOKENS.includes(token)) ALL_WINDOWS.forEach((kind) => found.add(kind));
    else if (FIVE_HOUR_TOKENS.includes(token)) found.add('fiveHour');
    else if (SEVEN_DAY_TOKENS.includes(token)) found.add('sevenDay');
    else if (SCOPED_TOKEN.test(token) && !scoped.includes(token)) scoped.push(token);
  }
  return { windows: ALL_WINDOWS.filter((kind) => found.has(kind)), scoped };
}

function typeOfWindows(windows: readonly UsageWindowKind[]): ResetGrantType | undefined {
  if (windows.length === ALL_WINDOWS.length) return 'full';
  if (windows[0] === 'fiveHour') return 'session';
  return windows[0] === 'sevenDay' ? 'weekly' : undefined;
}

function readId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return asText(value);
}

function readType(raw: unknown, declared: readonly UsageWindowKind[]): ResetGrantType | undefined {
  if (raw === undefined || raw === null) return typeOfWindows(declared);
  return RESET_GRANT_TYPES.find((candidate) => candidate === raw);
}

function readGrant(raw: unknown): ResetGrant | null {
  if (!isRecord(raw)) return null;
  const id = readId(raw['id']);
  const declared = readWindows(raw['clears']);
  const type = readType(raw['type'], declared.windows);
  if (id === null || type === undefined) return null;
  const total = asNumber(raw['resets_total']);
  const derived = declared.windows.length === 0 && declared.scoped.length === 0;
  return {
    id,
    label: asText(raw['label']),
    type,
    resetsLeft: Math.max(0, Math.floor(asNumber(raw['resets_left']) ?? 0)),
    resetsTotal: total === null ? null : Math.max(0, Math.floor(total)),
    startsAt: asTimestamp(raw['starts_at']),
    endsAt: asTimestamp(raw['ends_at']),
    clears: derived ? CLEARS_BY_TYPE[type] : declared.windows,
    clearsScoped: declared.scoped,
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
  return { atLimit: raw['at_limit'] === true, exhausted: readWindows(raw['exhausted']).windows, grants };
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

function clearsAll(grant: ResetGrant, blocked: ReadonlySet<UsageWindowKind>): boolean {
  return [...blocked].every((kind) => grant.clears.includes(kind));
}

function expiresBefore(a: ResetGrant, b: ResetGrant): number {
  if (a.endsAt === b.endsAt) return a.clears.length - b.clears.length;
  if (a.endsAt === null) return 1;
  if (b.endsAt === null) return -1;
  return a.endsAt - b.endsAt;
}

export function recommendedGrant(resets: UsageResets, snapshot: UsageSnapshot, now: number): ResetGrant | null {
  const blocked = blockedWindows(snapshot, resets);
  if (blocked.size === 0) return null;
  const candidates = resets.grants.filter(
    (grant) => isGrantUsable(grant, now) && grant.clears.some((kind) => blocked.has(kind)),
  );
  const rank = (a: ResetGrant, b: ResetGrant) =>
    Number(clearsAll(b, blocked)) - Number(clearsAll(a, blocked)) || expiresBefore(a, b);
  return [...candidates].sort(rank)[0] ?? null;
}
