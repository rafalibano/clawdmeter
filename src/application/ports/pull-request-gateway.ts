import type { PullRequestList } from '../../domain/pull-requests';

export interface PullRequestGateway {
  search<K extends string>(token: string, queries: Record<K, string>, limit: number): Promise<Record<K, PullRequestList>>;
}
