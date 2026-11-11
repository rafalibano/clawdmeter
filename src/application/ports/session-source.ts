import type { SessionUsage } from '../../domain/sessions';

export interface SessionDirectory {
  readAll(): Promise<string[]>;
}

export interface ProcessProbe {
  isAlive(pid: number): Promise<boolean>;
}

export interface SessionUsageReader {
  read(sessionId: string, cwd: string): Promise<SessionUsage | null>;
}
