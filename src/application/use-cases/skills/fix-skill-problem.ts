import { CLAUDE_CODE_INSTALL_URL } from '../../../domain/connections';
import type { RunFix } from '../../../domain/skills';
import type { TerminalLauncher, UrlOpener } from '../../ports';
import type { SkillRunBoard } from '../../skills/skill-run-board';

export class FixSkillProblem {
  constructor(
    private readonly board: SkillRunBoard,
    private readonly terminal: TerminalLauncher,
    private readonly urls: UrlOpener,
  ) {}

  async execute(fix: RunFix, runId?: string): Promise<void> {
    switch (fix) {
      case 'reconnect-mcp':
        await this.terminal.run({ program: 'claude', args: ['/mcp'], cwd: (runId ? this.board.get(runId)?.cwd : null) ?? null });
        return;
      case 'install-claude-code':
        await this.urls.open(CLAUDE_CODE_INSTALL_URL);
        return;
    }
  }
}
