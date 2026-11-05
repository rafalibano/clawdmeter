import { githubWebUrl } from '../../../domain/pull-requests';
import type { UrlOpener } from '../../ports';

export class OpenGitHubUrl {
  constructor(private readonly opener: UrlOpener) {}

  async execute(raw: string): Promise<void> {
    const url = githubWebUrl(raw);
    if (url === null) throw new Error('Link do GitHub inválido');
    await this.opener.open(url);
  }
}
