import type { PullRequestGateway } from '../../application/ports';
import { CodedError } from '../../domain/coded-error';
import { ConnectionProblemError } from '../../domain/connections';
import type {
  CiState,
  MergeState,
  PullRequest,
  PullRequestList,
  PullRequestState,
  ReviewDecision,
} from '../../domain/pull-requests';
import type { FetchLike } from '../platform/tauri-fetch';

const ENDPOINT = 'https://api.github.com/graphql';
// GitHub answers 502 when one request takes over 10 s; a page this size stays well under it.
const PAGE_SIZE = 25;

const PULL_REQUEST_FRAGMENT = `fragment PullRequestFields on PullRequest {
  id number title url isDraft state createdAt updatedAt mergeable reviewDecision
  author { login }
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

interface GraphqlNode {
  id?: string;
  number?: number;
  title?: string;
  url?: string;
  isDraft?: boolean;
  state?: string;
  createdAt?: string;
  updatedAt?: string;
  mergeable?: string;
  reviewDecision?: string | null;
  author?: { login?: string } | null;
  repository?: { nameWithOwner?: string };
  commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string } | null } } | null> };
}

interface GraphqlSearch {
  issueCount?: number;
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  nodes?: Array<GraphqlNode | null>;
}

interface GraphqlResponse {
  data?: { search?: GraphqlSearch | null } | null;
  errors?: Array<{ type?: string; message?: string }>;
  message?: string;
}

const SEARCH_QUERY = `query($query: String!, $first: Int!, $after: String) {
  search(query: $query, type: ISSUE, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ...PullRequestFields }
  }
}
${PULL_REQUEST_FRAGMENT}`;

const CI_STATES: Record<string, CiState> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  PENDING: 'pending',
  EXPECTED: 'pending',
};

const REVIEW_DECISIONS: Record<string, ReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  REVIEW_REQUIRED: 'review-required',
};

const MERGE_STATES: Record<string, MergeState> = { MERGEABLE: 'mergeable', CONFLICTING: 'conflicting' };
const PR_STATES: Record<string, PullRequestState> = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' };

export function toPullRequest(node: GraphqlNode | null): PullRequest | null {
  if (!node?.id || node.number === undefined || !node.url || !node.repository?.nameWithOwner) return null;
  const rollup = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
  return {
    id: node.id,
    number: node.number,
    title: node.title ?? '',
    url: node.url,
    repo: node.repository.nameWithOwner,
    author: node.author?.login ?? 'ghost',
    state: PR_STATES[node.state ?? ''] ?? 'open',
    isDraft: node.isDraft === true,
    ci: CI_STATES[rollup ?? ''] ?? 'none',
    review: REVIEW_DECISIONS[node.reviewDecision ?? ''] ?? 'none',
    merge: MERGE_STATES[node.mergeable ?? ''] ?? 'unknown',
    createdAt: Date.parse(node.createdAt ?? '') || 0,
    updatedAt: Date.parse(node.updatedAt ?? '') || 0,
  };
}

function blockingProblem(errors: NonNullable<GraphqlResponse['errors']>): ConnectionProblemError | Error | null {
  const text = errors.map((error) => `${error.type ?? ''} ${error.message ?? ''}`).join(' ');
  if (/INSUFFICIENT_SCOPES|scope/i.test(text)) return new ConnectionProblemError('github-missing-scope');
  if (/SAML|SSO/i.test(text)) return new ConnectionProblemError('github-org-access');
  if (errors.some((error) => error.type === 'RATE_LIMITED')) return new CodedError('github-rate-limited');
  return null;
}

export class GitHubGraphqlGateway implements PullRequestGateway {
  constructor(private readonly fetcher: FetchLike) {}

  async search<K extends string>(
    token: string,
    queries: Record<K, string>,
    limit: number,
  ): Promise<Record<K, PullRequestList>> {
    const aliases = Object.keys(queries) as K[];
    const lists = await Promise.all(aliases.map((alias) => this.searchOne(token, queries[alias], limit)));
    const result = {} as Record<K, PullRequestList>;
    aliases.forEach((alias, index) => (result[alias] = lists[index]!));
    return result;
  }

  private async searchOne(token: string, query: string, limit: number): Promise<PullRequestList> {
    const items: PullRequest[] = [];
    let total: number | null = null;
    let after: string | null = null;
    let fetched = 0;
    while (fetched < limit) {
      const first = Math.min(PAGE_SIZE, limit - fetched);
      const search = await this.page(token, { query, first, after });
      total ??= search?.issueCount ?? null;
      items.push(...(search?.nodes ?? []).flatMap((node) => toPullRequest(node) ?? []));
      fetched += first;
      after = search?.pageInfo?.endCursor ?? null;
      if (search?.pageInfo?.hasNextPage !== true || after === null) break;
    }
    return { items, total: total ?? items.length };
  }

  private async page(token: string, variables: { query: string; first: number; after: string | null }): Promise<GraphqlSearch | null> {
    const response = await this.fetcher(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: SEARCH_QUERY, variables }),
    });
    const body = await this.readBody(response);
    const errors = body.errors ?? [];
    const blocking = blockingProblem(errors);
    if (blocking) throw blocking;
    if (!body.data) throw new Error(errors[0]?.message ?? 'GitHub response without data.');
    return body.data.search ?? null;
  }

  private async readBody(response: Response): Promise<GraphqlResponse> {
    if (response.status === 401) throw new ConnectionProblemError('github-unauthorized');
    if (response.status === 403) {
      if (response.headers.get('x-github-sso') !== null) throw new ConnectionProblemError('github-org-access');
      if (response.headers.get('x-ratelimit-remaining') === '0') throw new CodedError('github-rate-limited');
      const detail = await response.json().catch(() => ({}) as GraphqlResponse);
      if (/SAML|SSO/i.test((detail as GraphqlResponse).message ?? '')) throw new ConnectionProblemError('github-org-access');
      throw new Error('GitHub responded 403.');
    }
    if (!response.ok) throw new Error(`GitHub responded ${response.status} on /graphql`);
    return (await response.json()) as GraphqlResponse;
  }
}
