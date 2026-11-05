import { CodedError } from '../../../domain/coded-error';
import { githubWebUrl } from '../../../domain/pull-requests';
import type { UrlOpener } from '../../ports';

export class OpenGitHubUrl {
  constructor(private readonly opener: UrlOpener) {}

  async execute(raw: string): Promise<void> {
    const url = githubWebUrl(raw);
    if (url === null) throw new CodedError('link-invalid-github');
    await this.opener.open(url);
  }
}
