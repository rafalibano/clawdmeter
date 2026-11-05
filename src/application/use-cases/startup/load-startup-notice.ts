import type { StartupNotice, StartupNotices } from '../../ports';

export class LoadStartupNotice {
  constructor(private readonly notices: StartupNotices) {}

  async execute(): Promise<StartupNotice | null> {
    try {
      return await this.notices.pending();
    } catch {
      return null;
    }
  }
}
