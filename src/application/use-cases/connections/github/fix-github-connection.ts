import {
  ConnectionProblemError,
  GITHUB_CLI_INSTALL_URL,
  GITHUB_ORG,
  GITHUB_ORG_SSO_URL,
  GITHUB_ORG_URL,
  GITHUB_REQUIRED_SCOPES,
  noteStatus,
  type ConnectionStatus,
  type FixAction,
} from '../../../../domain/connections';
import type { GitHubTokenResolver } from '../../../connections/github-token-resolver';
import type { StatusUseCase } from '../../../connections/connection-runner';
import type { ConnectionPrefsStore, GitHubAccountGateway, TerminalLauncher, UrlOpener } from '../../../ports';

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
      case 'connect-github-cli':
        await this.terminal.run({ program: 'gh', args: ['auth', 'login', '-h', 'github.com', '-w'] });
        return { state: 'disconnected', note: 'after-terminal', cli: 'login-opened' };
      case 'install-github-cli':
        await this.urls.open(GITHUB_CLI_INSTALL_URL);
        return { state: 'disconnected', note: 'after-install', cli: 'install-opened' };
      case 'regrant-scopes':
        return this.reauthenticate(
          ['auth', 'refresh', '-h', 'github.com', '-s', GITHUB_REQUIRED_SCOPES.join(',')],
          'github-missing-scope',
        );
      case 'authorize-org':
        await this.urls.open(await this.ssoUrl());
        return noteStatus('github-org-access', 'authorize-org');
      case 'open-org-page':
        await this.urls.open(GITHUB_ORG_URL);
        return noteStatus('github-not-member', 'ask-invite', GITHUB_ORG);
      default:
        throw new ConnectionProblemError('unexpected', `Fix does not apply to GitHub: ${fix}`);
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
      return noteStatus(problem, 'after-terminal');
    }
    await this.disconnect.execute();
    return { state: 'disconnected', note: 'after-reset' };
  }
}
