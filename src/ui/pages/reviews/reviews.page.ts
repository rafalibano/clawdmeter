import type { PageModule } from '../../../application/pages';
import type { PullRequests, PullRequestsData } from '../../../application/pull-requests';
import { PULL_REQUESTS_POLL_MS } from '../pull-requests/pull-requests.page';
import { ReviewsComponent } from './reviews.component';
import { REVIEWS_PAGE } from './reviews-page-ref';

export function createReviewsPage(deps: { pullRequests: PullRequests }): PageModule<PullRequestsData> {
  return {
    id: REVIEWS_PAGE.id,
    title: 'Reviews',
    requiredConnections: ['github'],
    pollIntervalMs: PULL_REQUESTS_POLL_MS,
    load: () => deps.pullRequests.loadReviews.execute(),
    component: ReviewsComponent,
  };
}
