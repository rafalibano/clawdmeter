import type { ProcessProbe, SessionDirectory, SessionUsageReader } from '../../application/ports';
import type { SessionUsage } from '../../domain/sessions';
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
    return [...files, '{ corrupt file'];
  }
}

export class DemoProcessProbe implements ProcessProbe {
  async isAlive(pid: number): Promise<boolean> {
    return DEMO_SESSIONS.some((session) => session.pid === pid && session.alive);
  }
}

const DEMO_USAGE: Readonly<Record<number, Omit<SessionUsage, 'subagents'> & { subagents: Array<[string, string, number]> }>> = {
  41001: {
    model: 'claude-opus-5-5',
    contextTokens: 412_000,
    longContext: false,
    inputTokens: 18_400,
    outputTokens: 96_200,
    cacheReadTokens: 6_810_000,
    cacheCreationTokens: 402_000,
    subagents: [
      ['general-purpose', 'claude-sonnet-5-5', 4 * MINUTE_MS],
      ['Explore', 'claude-haiku-5-5', 50 * SECOND_MS],
    ],
  },
  41002: {
    model: 'claude-sonnet-5-5',
    contextTokens: 88_000,
    longContext: false,
    inputTokens: 3_100,
    outputTokens: 12_400,
    cacheReadTokens: 910_000,
    cacheCreationTokens: 61_000,
    subagents: [],
  },
  41003: {
    model: 'claude-opus-5-5',
    contextTokens: 905_000,
    longContext: false,
    inputTokens: 40_200,
    outputTokens: 210_000,
    cacheReadTokens: 21_400_000,
    cacheCreationTokens: 980_000,
    subagents: [['dotnet-code-reviewer', 'claude-opus-5-5', 12 * MINUTE_MS]],
  },
};

export class DemoSessionUsageReader implements SessionUsageReader {
  constructor(private readonly origin: number) {}

  async read(sessionId: string): Promise<SessionUsage | null> {
    const usage = DEMO_USAGE[Number(sessionId.replace('demo-', ''))];
    if (usage === undefined) return null;
    return {
      ...usage,
      subagents: usage.subagents.map(([agentType, model, ageMs], index) => ({
        id: `${sessionId}-agent-${index}`,
        agentType,
        model,
        startedAt: this.origin - ageMs,
      })),
    };
  }
}
