import { teamsJoinUrl } from '../../../domain/calendar';
import type { UrlOpener } from '../../ports';

export class JoinMeeting {
  constructor(private readonly opener: UrlOpener) {}

  async execute(joinUrl: string | null): Promise<void> {
    const url = teamsJoinUrl(joinUrl);
    if (url === null) throw new Error('Link da reunião inválido');
    await this.opener.open(url);
  }
}
