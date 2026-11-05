export type CiState = 'success' | 'failure' | 'pending' | 'none';
export type ReviewDecision = 'approved' | 'changes-requested' | 'review-required' | 'none';
export type MergeState = 'mergeable' | 'conflicting' | 'unknown';
export type PullRequestState = 'open' | 'merged' | 'closed';

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  state: PullRequestState;
  isDraft: boolean;
  ci: CiState;
  review: ReviewDecision;
  merge: MergeState;
  createdAt: number;
  updatedAt: number;
}

export interface PullRequestList {
  items: PullRequest[];
  total: number;
}

export function isTruncated(list: PullRequestList): boolean {
  return list.total > list.items.length;
}
