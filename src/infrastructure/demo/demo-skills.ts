import type {
  SkillRunStore,
  SkillsConfigStore,
  StreamingProcessHandle,
  StreamingProcessHandlers,
  StreamingProcessRunner,
  StreamingProcessSpec,
  TerminalLauncher,
  UrlOpener,
} from '../../application/ports';
import type { SkillAdapters } from '../../application/skills';
import { ConnectionProblemError } from '../../domain/connections';
import {
  DEFAULT_SKILLS,
  MCP_NEEDS_AUTH_STREAM,
  SUCCESS_STREAM,
  type SkillDefinition,
  type SkillRun,
} from '../../domain/skills';
import type { DemoWorld } from './demo-world';

const DEMO_LINE_INTERVAL_MS = 700;

const DEMO_SKILLS: SkillDefinition[] = [
  ...DEFAULT_SKILLS.map((skill) => ({ ...skill })),
  {
    id: 'resumo-prs',
    name: 'Resumo dos PRs',
    prompt: '/prs',
    maxBudgetUsd: 1,
    allowedTools: ['Read', 'Bash(gh:*)'],
    cwd: null,
  },
];

class DemoSkillsConfig implements SkillsConfigStore {
  async load(): Promise<SkillDefinition[]> {
    return DEMO_SKILLS;
  }
}

class DemoSkillRunStore implements SkillRunStore {
  private runs: SkillRun[] = [];

  async load(): Promise<SkillRun[]> {
    return this.runs;
  }

  async save(runs: SkillRun[]): Promise<void> {
    this.runs = runs;
  }
}

class DemoStreamingProcessRunner implements StreamingProcessRunner {
  constructor(private readonly world: DemoWorld) {}

  async start(_spec: StreamingProcessSpec, handlers: StreamingProcessHandlers): Promise<StreamingProcessHandle> {
    if (this.world.skills.claudeMissing) {
      throw new ConnectionProblemError('claude-code-missing', 'claude não encontrado (cenário demo)');
    }
    const needsAuth = this.world.skills.mcpNeedsAuth;
    const lines = needsAuth ? MCP_NEEDS_AUTH_STREAM : SUCCESS_STREAM;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let finished = false;
    const end = (code: number | null): void => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      handlers.onExit(code);
    };
    lines.forEach((line, index) => {
      timers.push(setTimeout(() => handlers.onLine(line, 'stdout'), (index + 1) * DEMO_LINE_INTERVAL_MS));
    });
    timers.push(setTimeout(() => end(needsAuth ? 1 : 0), (lines.length + 1) * DEMO_LINE_INTERVAL_MS));
    return { kill: async () => end(null) };
  }
}

export function createDemoSkillAdapters(
  world: DemoWorld,
  shared: { terminal: TerminalLauncher; urls: UrlOpener },
): SkillAdapters {
  return {
    config: new DemoSkillsConfig(),
    runs: new DemoSkillRunStore(),
    runner: new DemoStreamingProcessRunner(world),
    terminal: shared.terminal,
    urls: shared.urls,
  };
}
