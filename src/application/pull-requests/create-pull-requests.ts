import type { Clock, ConnectionPrefsStore, PullRequestGateway } from '../ports';
import type { GitHubTokenResolver } from '../connections/github-token-resolver';
import { LoadMyPullRequests, LoadReviews } from '../use-cases/pull-requests';
import { GitHubSession } from './github-session';

export interface PullRequestAdapters {
  prefs: ConnectionPrefsStore;
  tokens: GitHubTokenResolver;
  gateway: PullRequestGateway;
}

export interface PullRequests {
  loadMine: LoadMyPullRequests;
  loadReviews: LoadReviews;
}

export function createPullRequests(adapters: PullRequestAdapters, clock: Clock): PullRequests {
  const session = new GitHubSession(adapters.prefs, adapters.tokens);
  return {
    loadMine: new LoadMyPullRequests(session, adapters.gateway),
    loadReviews: new LoadReviews(session, adapters.gateway, clock),
  };
}
