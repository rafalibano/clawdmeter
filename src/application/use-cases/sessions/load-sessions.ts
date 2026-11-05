import { parseSessionFile, sortSessions, type ClaudeSession, type SessionAttentionConfig } from '../../../domain/sessions';
import type { Clock, ProcessProbe, SessionDirectory } from '../../ports';

export interface SessionsData {
  at: number;
  sessions: ClaudeSession[];
  attention: SessionAttentionConfig;
}

export class LoadSessions {
  constructor(
    private readonly directory: SessionDirectory,
    private readonly probe: ProcessProbe,
    private readonly clock: Clock,
    private readonly attention: SessionAttentionConfig,
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
    return { at: now, sessions, attention: this.attention };
  }
}
