import { MINE_QUERY, groupByRepo, searchPageUrl } from '../../../domain/pull-requests';
import type { GitHubSession } from '../../pull-requests/github-session';
import type { PullRequestsData } from '../../pull-requests/page-data';
import type { PullRequestGateway } from '../../ports';

export const PULL_REQUEST_LIMIT = 50;

export class LoadMyPullRequests {
  constructor(
    private readonly session: GitHubSession,
    private readonly gateway: PullRequestGateway,
  ) {}

  async execute(): Promise<PullRequestsData> {
    const token = await this.session.token();
    const { mine } = await this.gateway.search(token, { mine: MINE_QUERY }, PULL_REQUEST_LIMIT);
    return {
      sections: [
        {
          id: 'mine',
          groups: groupByRepo(mine.items),
          shown: mine.items.length,
          total: mine.total,
          searchUrl: searchPageUrl(MINE_QUERY),
        },
      ],
    };
  }
}
