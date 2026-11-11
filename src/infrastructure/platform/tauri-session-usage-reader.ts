import type { SessionUsageReader } from '../../application/ports';
import type { SessionUsage, SubagentUsage } from '../../domain/sessions';
import type { TauriCommands } from './tauri-commands';

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function instant(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

function toSubagent(raw: unknown): SubagentUsage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = text(record['id']);
  if (id === null) return null;
  return { id, agentType: text(record['agentType']), model: text(record['model']), startedAt: instant(record['startedAt']) };
}

export function toSessionUsage(raw: unknown): SessionUsage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const context = record['contextTokens'];
  const subagents = Array.isArray(record['subagents']) ? record['subagents'] : [];
  return {
    model: text(record['model']),
    contextTokens: typeof context === 'number' && Number.isFinite(context) ? context : null,
    longContext: record['longContext'] === true,
    inputTokens: tokens(record['inputTokens']),
    outputTokens: tokens(record['outputTokens']),
    cacheReadTokens: tokens(record['cacheReadTokens']),
    cacheCreationTokens: tokens(record['cacheCreationTokens']),
    subagents: subagents.map(toSubagent).filter((subagent): subagent is SubagentUsage => subagent !== null),
  };
}

export class TauriSessionUsageReader implements SessionUsageReader {
  constructor(private readonly commands: TauriCommands) {}

  async read(sessionId: string, cwd: string): Promise<SessionUsage | null> {
    return toSessionUsage(await this.commands.call<unknown>('session_usage', { sessionId, cwd }));
  }
}
