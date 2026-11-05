import { CodedError } from '../../../domain/coded-error';
import { isResumableSession } from '../../../domain/skills';
import type { TerminalLauncher } from '../../ports';
import type { SkillRunBoard } from '../../skills/skill-run-board';

export class ContinueSkillInTerminal {
  constructor(
    private readonly board: SkillRunBoard,
    private readonly terminal: TerminalLauncher,
  ) {}

  async execute(runId: string): Promise<void> {
    const run = this.board.get(runId);
    const sessionId = run?.sessionId ?? null;
    if (!isResumableSession(sessionId)) throw new CodedError('skill-no-session');
    await this.terminal.run({ program: 'claude', args: ['--resume', sessionId], cwd: run?.cwd ?? null });
  }
}
