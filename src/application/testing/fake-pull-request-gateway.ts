import type { PullRequestList } from '../../domain/pull-requests';
import type { PullRequestGateway } from '../ports';

export class FakePullRequestGateway implements PullRequestGateway {
  lists = new Map<string, PullRequestList>();
  outcome: Error | null = null;
  readonly calls: Array<{ token: string; queries: Record<string, string>; limit: number }> = [];

  async search<K extends string>(
    token: string,
    queries: Record<K, string>,
    limit: number,
  ): Promise<Record<K, PullRequestList>> {
    this.calls.push({ token, queries, limit });
    if (this.outcome) throw this.outcome;
    const result = {} as Record<K, PullRequestList>;
    for (const key of Object.keys(queries) as K[]) result[key] = this.lists.get(key) ?? { items: [], total: 0 };
    return result;
  }
}
