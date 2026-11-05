import {
  ConnectionProblemError,
  GITHUB_ORG,
  GITHUB_ORG_SSO_URL,
  GITHUB_ORG_URL,
  GITHUB_REQUIRED_SCOPES,
  errorStatus,
  type ConnectionStatus,
  type FixAction,
} from '../../../../domain/connections';
import type { GitHubTokenResolver } from '../../../connections/github-token-resolver';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { ConnectionPrefsStore, GitHubAccountGateway, TerminalLauncher, UrlOpener } from '../../../ports';

const AFTER_TERMINAL = 'Conclua no Terminal e clique em "Verificar de novo".';
const AFTER_RESET = 'Entre de novo com o código do GitHub ou cole um novo token.';

export class FixGitHubConnection implements StatusUseCase<FixAction> {
  constructor(
    private readonly prefs: ConnectionPrefsStore,
    private readonly check: StatusUseCase,
    private readonly disconnect: StatusUseCase,
    private readonly terminal: TerminalLauncher,
    private readonly urls: UrlOpener,
    private readonly tokens: GitHubTokenResolver,
    private readonly accounts: GitHubAccountGateway,
  ) {}

  async execute(fix: FixAction): Promise<ConnectionStatus> {
    switch (fix) {
      case 'retry-permission':
      case 'retry':
        return this.check.execute();
      case 'relogin-github':
        return this.reauthenticate(['auth', 'login', '-h', 'github.com', '-w'], 'github-unauthorized');
      case 'regrant-scopes':
        return this.reauthenticate(
          ['auth', 'refresh', '-h', 'github.com', '-s', GITHUB_REQUIRED_SCOPES.join(',')],
          'github-missing-scope',
        );
      case 'authorize-org':
        await this.urls.open(await this.ssoUrl());
        return errorStatus('github-org-access', 'Autorize o token na org e clique em "Verificar de novo".');
      case 'open-org-page':
        await this.urls.open(GITHUB_ORG_URL);
        return errorStatus(
          'github-not-member',
          `Peça o convite para a org ${GITHUB_ORG} e clique em "Verificar de novo".`,
        );
      default:
        throw new ConnectionProblemError('unexpected', `Conserto não se aplica ao GitHub: ${fix}`);
    }
  }

  private async ssoUrl(): Promise<string> {
    try {
      const { method } = (await this.prefs.load()).github;
      if (method === null) return GITHUB_ORG_SSO_URL;
      const token = await this.tokens.resolve(method);
      if (token === null) return GITHUB_ORG_SSO_URL;
      return (await this.accounts.inspect(token)).ssoUrl ?? GITHUB_ORG_SSO_URL;
    } catch {
      return GITHUB_ORG_SSO_URL;
    }
  }

  private async reauthenticate(
    cliArgs: string[],
    problem: 'github-unauthorized' | 'github-missing-scope',
  ): Promise<ConnectionStatus> {
    const { method } = (await this.prefs.load()).github;
    if (method === 'gh-cli') {
      await this.terminal.run({ program: 'gh', args: cliArgs });
      return errorStatus(problem, AFTER_TERMINAL);
    }
    await this.disconnect.execute();
    return { state: 'disconnected', hint: AFTER_RESET };
  }
}
