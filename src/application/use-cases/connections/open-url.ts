import type { UrlOpener } from '../../ports';

export class OpenUrl {
  constructor(private readonly opener: UrlOpener) {}

  execute(url: string): Promise<void> {
    return this.opener.open(url);
  }
}
