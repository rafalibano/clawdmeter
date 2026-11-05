import type { SkillRunBoard } from '../../skills/skill-run-board';
import type { SkillRunStore } from '../../ports';

export class LoadSkillRuns {
  constructor(
    private readonly store: SkillRunStore,
    private readonly board: SkillRunBoard,
  ) {}

  async execute(): Promise<void> {
    this.board.hydrate(await this.store.load());
  }
}
