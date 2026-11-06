import { ASSIGNED_QUERY, MINE_QUERY, groupByRepo, searchPageUrl } from '../../../domain/pull-requests';
import type { PullRequestList } from '../../../domain/pull-requests';
import type { GitHubSession } from '../../pull-requests/github-session';
import type { PullRequestSection, PullRequestsData } from '../../pull-requests/page-data';
import type { PullRequestGateway } from '../../ports';

export const PULL_REQUEST_LIMIT = 50;

function section(id: string, list: PullRequestList, query: string, showAuthor: boolean): PullRequestSection {
  return {
    id,
    groups: groupByRepo(list.items),
    shown: list.items.length,
    total: list.total,
    searchUrl: searchPageUrl(query),
    showAuthor,
  };
}

export class LoadMyPullRequests {
  constructor(
    private readonly session: GitHubSession,
    private readonly gateway: PullRequestGateway,
  ) {}

  async execute(): Promise<PullRequestsData> {
    const token = await this.session.token();
    const { mine, assigned } = await this.gateway.search(
      token,
      { mine: MINE_QUERY, assigned: ASSIGNED_QUERY },
      PULL_REQUEST_LIMIT,
    );
    return {
      sections: [section('mine', mine, MINE_QUERY, false), section('assigned', assigned, ASSIGNED_QUERY, true)],
    };
  }
}
