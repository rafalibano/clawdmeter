import type { ProcessProbe, SessionDirectory } from '../../application/ports';
import { MINUTE_MS, SECOND_MS } from '../../domain/time';

interface DemoSession {
  pid: number;
  name: string | null;
  cwd: string;
  status: 'busy' | 'idle' | 'shell';
  ageMs: number;
  alive: boolean;
}

const DEMO_SESSIONS: readonly DemoSession[] = [
  { pid: 41001, name: 'api-gateway', cwd: '/Users/dev/code/api-gateway', status: 'busy', ageMs: 40 * SECOND_MS, alive: true },
  { pid: 41002, name: 'billing-refactor', cwd: '/Users/dev/code/billing-service', status: 'idle', ageMs: 9 * MINUTE_MS, alive: true },
  { pid: 41003, name: null, cwd: '/Users/dev/code/web-dashboard', status: 'busy', ageMs: 52 * MINUTE_MS, alive: true },
  { pid: 41004, name: 'docs-site', cwd: '/Users/dev/code/docs-site', status: 'idle', ageMs: 40 * SECOND_MS, alive: true },
  { pid: 41005, name: null, cwd: '/Users/dev/code/infra-scripts', status: 'shell', ageMs: 3 * MINUTE_MS, alive: true },
  { pid: 41006, name: 'old-experiment', cwd: '/Users/dev/code/sandbox', status: 'idle', ageMs: 120 * MINUTE_MS, alive: false },
];

export class DemoSessionDirectory implements SessionDirectory {
  constructor(private readonly origin: number) {}

  async readAll(): Promise<string[]> {
    const files = DEMO_SESSIONS.map((session) =>
      JSON.stringify({
        pid: session.pid,
        sessionId: `demo-${session.pid}`,
        cwd: session.cwd,
        name: session.name,
        status: session.status,
        updatedAt: this.origin - session.ageMs,
        statusUpdatedAt: this.origin - session.ageMs,
        version: '2.1.0',
        kind: 'interactive',
      }),
    );
    return [...files, '{ arquivo corrompido'];
  }
}

export class DemoProcessProbe implements ProcessProbe {
  async isAlive(pid: number): Promise<boolean> {
    return DEMO_SESSIONS.some((session) => session.pid === pid && session.alive);
  }
}
