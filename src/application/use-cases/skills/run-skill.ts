import { ConnectionProblemError } from '../../../domain/connections';
import {
  applyStreamEvent,
  buildClaudeArgs,
  finishRun,
  parseStreamLine,
  startRun,
  toStoredRun,
  trimHistory,
  type SkillRun,
} from '../../../domain/skills';
import type { Clock, SkillRunStore, SkillsConfigStore, StreamingProcessRunner } from '../../ports';
import type { SkillRunBoard } from '../../skills/skill-run-board';
import type { NotifyRunFinished } from './notify-run-finished';

const STDERR_TAIL_CHARS = 2_000;

export interface StartedRun {
  run: SkillRun;
  finished: Promise<SkillRun>;
}

export class RunSkill {
  private sequence = 0;

  constructor(
    private readonly config: SkillsConfigStore,
    private readonly runner: StreamingProcessRunner,
    private readonly store: SkillRunStore,
    private readonly board: SkillRunBoard,
    private readonly clock: Clock,
    private readonly notify: NotifyRunFinished,
  ) {}

  async execute(skillId: string): Promise<StartedRun> {
    const skill = (await this.config.load()).find((candidate) => candidate.id === skillId);
    if (!skill) throw new Error(`Skill desconhecida: ${skillId}`);
    if (this.board.isSkillRunning(skill.id)) throw new Error(`${skill.name} já está rodando.`);
    const args = buildClaudeArgs(skill);

    this.sequence += 1;
    const initial = startRun(`${skill.id}-${this.clock.now().toString(36)}-${this.sequence}`, skill, this.clock.now());
    let current = initial;
    let stderrTail = '';
    this.board.put(current);

    let settle: (run: SkillRun) => void = () => undefined;
    const finished = new Promise<SkillRun>((resolve) => (settle = resolve));

    const conclude = async (next: SkillRun): Promise<void> => {
      current = next;
      this.board.release(current.id);
      this.board.put(current);
      await this.store.save(trimHistory(this.board.finished().map(toStoredRun))).catch(() => undefined);
      await this.notify.execute(current);
      settle(current);
    };

    try {
      const handle = await this.runner.start(
        { program: 'claude', args, cwd: skill.cwd },
        {
          onLine: (line, stream) => {
            if (stream === 'stderr') {
              stderrTail = `${stderrTail}${line}\n`.slice(-STDERR_TAIL_CHARS);
              return;
            }
            const event = parseStreamLine(line);
            if (event === null || event.type === 'other') return;
            current = applyStreamEvent(current, event);
            this.board.put(current);
          },
          onExit: (code) => {
            void conclude(
              finishRun(current, {
                code,
                cancelled: this.board.wasCancelled(current.id),
                stderrTail,
                now: this.clock.now(),
              }),
            );
          },
        },
      );
      this.board.attach(initial.id, handle);
      if (this.board.wasCancelled(initial.id)) await handle.kill().catch(() => undefined);
    } catch (error) {
      const missing = error instanceof ConnectionProblemError && error.problem === 'claude-code-missing';
      const message = error instanceof Error ? error.message : String(error);
      await conclude({
        ...current,
        status: 'failed',
        endedAt: this.clock.now(),
        error: message,
        problem: missing ? 'claude-code-missing' : current.problem,
      });
    }
    return { run: initial, finished };
  }
}
