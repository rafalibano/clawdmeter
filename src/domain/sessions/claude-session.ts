export type SessionStatus = 'busy' | 'idle' | 'shell';

export interface ClaudeSession {
  pid: number;
  sessionId: string | null;
  cwd: string | null;
  name: string | null;
  status: SessionStatus | null;
  updatedAt: number | null;
  statusUpdatedAt: number | null;
  version: string | null;
  kind: string | null;
  messagingSocketPath: string | null;
}

const STATUSES: readonly string[] = ['busy', 'idle', 'shell'];

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asPid(value: unknown): number | null {
  const pid = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null;
}

function asTimestamp(value: unknown): number | null {
  if (typeof value === 'string') {
    if (/^\d+(\.\d+)?$/.test(value.trim())) return asTimestamp(Number(value));
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e11 ? value * 1_000 : value;
}

export function parseSession(raw: unknown): ClaudeSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const pid = asPid(record['pid']);
  if (pid === null) return null;
  const status = asText(record['status']);
  return {
    pid,
    sessionId: asText(record['sessionId']),
    cwd: asText(record['cwd']),
    name: asText(record['name']),
    status: status !== null && STATUSES.includes(status) ? (status as SessionStatus) : null,
    updatedAt: asTimestamp(record['updatedAt']),
    statusUpdatedAt: asTimestamp(record['statusUpdatedAt']),
    version: asText(record['version']),
    kind: asText(record['kind']),
    messagingSocketPath: asText(record['messagingSocketPath']),
  };
}

export function parseSessionFile(text: string): ClaudeSession | null {
  try {
    return parseSession(JSON.parse(text));
  } catch {
    return null;
  }
}

export function statusSince(session: ClaudeSession): number | null {
  return session.statusUpdatedAt ?? session.updatedAt;
}

export function pathSegments(path: string): string[] {
  return path.split(/[\\/]/).filter((segment) => segment !== '');
}

export function shortCwd(cwd: string | null): string {
  if (cwd === null) return '—';
  const segments = pathSegments(cwd);
  if (segments.length === 0) return cwd;
  return segments.slice(-2).join('/');
}

export function sessionTitle(session: ClaudeSession): string {
  if (session.name !== null) return session.name;
  const segments = session.cwd === null ? [] : pathSegments(session.cwd);
  return segments[segments.length - 1] ?? `pid ${session.pid}`;
}
