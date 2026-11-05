import { CLAUDE_CODE_INSTALL_URL } from '../../../domain/connections';
import type { RunFix } from '../../../domain/skills';
import type { TerminalLauncher, UrlOpener } from '../../ports';

export class FixSkillProblem {
  constructor(
    private readonly terminal: TerminalLauncher,
    private readonly urls: UrlOpener,
  ) {}

  async execute(fix: RunFix): Promise<void> {
    switch (fix) {
      case 'reconnect-mcp':
        await this.terminal.run({ program: 'claude', args: ['/mcp'] });
        return;
      case 'install-claude-code':
        await this.urls.open(CLAUDE_CODE_INSTALL_URL);
        return;
    }
  }
}
