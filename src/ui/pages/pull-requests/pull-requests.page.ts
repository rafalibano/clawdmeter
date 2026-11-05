import type { PageModule } from '../../../application/pages';
import type { PullRequests, PullRequestsData } from '../../../application/pull-requests';
import { PullRequestsComponent } from './pull-requests.component';
import { PULL_REQUESTS_PAGE } from './pull-requests-page-ref';

export const PULL_REQUESTS_POLL_MS = 120_000;

export function createPullRequestsPage(deps: { pullRequests: PullRequests }): PageModule<PullRequestsData> {
  return {
    id: PULL_REQUESTS_PAGE.id,
    title: 'PRs',
    requiredConnections: ['github'],
    pollIntervalMs: PULL_REQUESTS_POLL_MS,
    load: () => deps.pullRequests.loadMine.execute(),
    component: PullRequestsComponent,
  };
}
