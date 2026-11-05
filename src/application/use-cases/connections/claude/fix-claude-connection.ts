import {
  CLAUDE_CODE_INSTALL_URL,
  ConnectionProblemError,
  errorStatus,
  type ConnectionStatus,
  type FixAction,
} from '../../../../domain/connections';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { TerminalLauncher, UrlOpener } from '../../../ports';

export class FixClaudeConnection implements StatusUseCase<FixAction> {
  constructor(
    private readonly check: StatusUseCase,
    private readonly terminal: TerminalLauncher,
    private readonly urls: UrlOpener,
  ) {}

  async execute(fix: FixAction): Promise<ConnectionStatus> {
    switch (fix) {
      case 'retry-permission':
      case 'retry':
        return this.check.execute();
      case 'relogin-claude':
        await this.terminal.run({ program: 'claude', args: ['/login'] });
        return errorStatus('claude-expired', 'Conclua o login no Terminal e clique em "Verificar de novo".');
      case 'install-claude-code':
        await this.urls.open(CLAUDE_CODE_INSTALL_URL);
        return errorStatus('claude-code-missing', 'Instale o Claude Code e clique em "Verificar de novo".');
      default:
        throw new ConnectionProblemError('unexpected', `Conserto não se aplica ao Claude: ${fix}`);
    }
  }
}
