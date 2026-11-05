import type { SkillRunBoard } from '../../skills/skill-run-board';

export class CancelSkillRun {
  constructor(private readonly board: SkillRunBoard) {}

  async execute(runId: string): Promise<void> {
    const handle = this.board.handleOf(runId);
    if (!handle) return;
    this.board.markCancelled(runId);
    await handle.kill();
  }
}
