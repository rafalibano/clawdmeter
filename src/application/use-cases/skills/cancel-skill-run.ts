import { isRunning } from '../../../domain/skills';
import type { SkillRunBoard } from '../../skills/skill-run-board';

export class CancelSkillRun {
  constructor(private readonly board: SkillRunBoard) {}

  async execute(runId: string): Promise<void> {
    const run = this.board.get(runId);
    if (!run || !isRunning(run)) return;
    this.board.markCancelled(runId);
    await this.board.handleOf(runId)?.kill();
  }
}
