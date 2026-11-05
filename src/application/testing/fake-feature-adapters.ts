import { parseSkillsConfig, type SkillDefinition, type SkillRun } from '../../domain/skills';
import type {
  SkillRunStore,
  SkillsConfigStore,
  StreamingProcessHandle,
  StreamingProcessHandlers,
  StreamingProcessRunner,
  StreamingProcessSpec,
} from '../ports';

export class FakeSkillsConfigStore implements SkillsConfigStore {
  constructor(public skills: SkillDefinition[] = parseSkillsConfig(null)) {}

  async load(): Promise<SkillDefinition[]> {
    return this.skills;
  }
}

export class FakeSkillRunStore implements SkillRunStore {
  saved: SkillRun[][] = [];
  stored: SkillRun[] = [];
  failSave = false;

  async load(): Promise<SkillRun[]> {
    return this.stored;
  }

  async save(runs: SkillRun[]): Promise<void> {
    if (this.failSave) throw new Error('disco cheio');
    this.stored = runs;
    this.saved.push(runs);
  }
}

export class FakeProcess implements StreamingProcessHandle {
  killed = 0;

  constructor(
    readonly spec: StreamingProcessSpec,
    private readonly handlers: StreamingProcessHandlers,
  ) {}

  async kill(): Promise<void> {
    this.killed += 1;
    this.handlers.onExit(null);
  }

  stdout(line: string): void {
    this.handlers.onLine(line, 'stdout');
  }

  stderr(line: string): void {
    this.handlers.onLine(line, 'stderr');
  }

  exit(code: number | null): void {
    this.handlers.onExit(code);
  }
}

export class FakeStreamingProcessRunner implements StreamingProcessRunner {
  startError: Error | null = null;
  readonly processes: FakeProcess[] = [];

  async start(spec: StreamingProcessSpec, handlers: StreamingProcessHandlers): Promise<StreamingProcessHandle> {
    if (this.startError) throw this.startError;
    const process = new FakeProcess(spec, handlers);
    this.processes.push(process);
    return process;
  }
}
