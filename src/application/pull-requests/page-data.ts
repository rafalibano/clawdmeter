import type { PullRequestGroup } from '../../domain/pull-requests';

export interface PullRequestSection {
  id: string;
  groups: PullRequestGroup[];
  shown: number;
  total: number;
  searchUrl: string;
  showAuthor: boolean;
}

export interface PullRequestsData {
  sections: PullRequestSection[];
}
