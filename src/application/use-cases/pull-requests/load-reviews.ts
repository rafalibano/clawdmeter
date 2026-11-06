import {
  REVIEWED_OPEN_QUERY,
  TO_REVIEW_QUERY,
  groupByRepo,
  mergeUnique,
  reviewedAllQuery,
  reviewedRecentQuery,
  searchPageUrl,
} from '../../../domain/pull-requests';
import type { GitHubSession } from '../../pull-requests/github-session';
import type { PullRequestsData } from '../../pull-requests/page-data';
import type { Clock, PullRequestGateway } from '../../ports';
import { PULL_REQUEST_LIMIT } from './load-my-pull-requests';

export class LoadReviews {
  constructor(
    private readonly session: GitHubSession,
    private readonly gateway: PullRequestGateway,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<PullRequestsData> {
    const token = await this.session.token();
    const recentQuery = reviewedRecentQuery(this.clock.now());
    const { toReview, reviewedOpen, reviewedRecent } = await this.gateway.search(
      token,
      { toReview: TO_REVIEW_QUERY, reviewedOpen: REVIEWED_OPEN_QUERY, reviewedRecent: recentQuery },
      PULL_REQUEST_LIMIT,
    );
    const reviewed = mergeUnique(reviewedOpen.items, reviewedRecent.items);
    return {
      sections: [
        {
          id: 'to-review',
          groups: groupByRepo(toReview.items),
          shown: toReview.items.length,
          total: toReview.total,
          searchUrl: searchPageUrl(TO_REVIEW_QUERY),
          showAuthor: true,
        },
        {
          id: 'reviewed',
          groups: groupByRepo(reviewed),
          shown: reviewed.length,
          total: reviewedOpen.total + reviewedRecent.total,
          searchUrl: searchPageUrl(reviewedAllQuery(this.clock.now())),
          showAuthor: true,
        },
      ],
    };
  }
}
