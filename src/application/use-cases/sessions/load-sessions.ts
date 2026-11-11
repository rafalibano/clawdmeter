import {
  parseSessionFile,
  sortSessions,
  type ClaudeSession,
  type SessionAttentionConfig,
  type SessionUsage,
} from '../../../domain/sessions';
import type { Clock, ProcessProbe, SessionDirectory, SessionUsageReader } from '../../ports';

export interface SessionsData {
  at: number;
  sessions: ClaudeSession[];
  attention: SessionAttentionConfig;
  usage: ReadonlyMap<number, SessionUsage>;
}

export class LoadSessions {
  constructor(
    private readonly directory: SessionDirectory,
    private readonly probe: ProcessProbe,
    private readonly clock: Clock,
    private readonly attention: SessionAttentionConfig,
    private readonly usageReader?: SessionUsageReader,
  ) {}

  async execute(): Promise<SessionsData> {
    const now = this.clock.now();
    const parsed = (await this.directory.readAll())
      .map((text) => parseSessionFile(text))
      .filter((session): session is ClaudeSession => session !== null);
    const unique = [...new Map(parsed.map((session) => [session.pid, session])).values()];
    const alive = await Promise.all(unique.map((session) => this.probe.isAlive(session.pid)));
    const sessions = sortSessions(
      unique.filter((_, index) => alive[index]),
      now,
      this.attention,
    );
    return { at: now, sessions, attention: this.attention, usage: await this.readUsage(sessions) };
  }

  private async readUsage(sessions: readonly ClaudeSession[]): Promise<ReadonlyMap<number, SessionUsage>> {
    const reader = this.usageReader;
    if (reader === undefined) return new Map();
    const entries = await Promise.all(
      sessions.map(async (session): Promise<[number, SessionUsage] | null> => {
        if (session.sessionId === null || session.cwd === null) return null;
        const usage = await reader.read(session.sessionId, session.cwd).catch(() => null);
        return usage === null ? null : [session.pid, usage];
      }),
    );
    return new Map(entries.filter((entry): entry is [number, SessionUsage] => entry !== null));
  }
}
