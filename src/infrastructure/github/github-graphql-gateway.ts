import type { PullRequestGateway } from '../../application/ports';
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
const ALIAS_PATTERN = /^[a-z][A-Za-z0-9]*$/;

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

interface GraphqlResponse {
  data?: Record<string, { issueCount?: number; nodes?: Array<GraphqlNode | null> } | null> | null;
  errors?: Array<{ type?: string; message?: string }>;
  message?: string;
}

export function buildSearchQuery(aliases: readonly string[]): string {
  for (const alias of aliases) {
    if (!ALIAS_PATTERN.test(alias)) throw new Error(`Alias de busca inválido: ${alias}`);
  }
  const variables = aliases.map((alias) => `$${alias}: String!`).join(', ');
  const searches = aliases
    .map((alias) => `${alias}: search(query: $${alias}, type: ISSUE, first: $first) { issueCount nodes { ...PullRequestFields } }`)
    .join('\n  ');
  return `query(${variables}, $first: Int!) {\n  ${searches}\n}\n${PULL_REQUEST_FRAGMENT}`;
}

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

const RATE_LIMIT_MESSAGE = 'Limite de requisições do GitHub atingido. Tente de novo em alguns minutos.';

function blockingProblem(errors: NonNullable<GraphqlResponse['errors']>): ConnectionProblemError | Error | null {
  const text = errors.map((error) => `${error.type ?? ''} ${error.message ?? ''}`).join(' ');
  if (/INSUFFICIENT_SCOPES|scope/i.test(text)) return new ConnectionProblemError('github-missing-scope');
  if (/SAML|SSO/i.test(text)) return new ConnectionProblemError('github-org-access');
  if (errors.some((error) => error.type === 'RATE_LIMITED')) return new Error(RATE_LIMIT_MESSAGE);
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
    const response = await this.fetcher(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: buildSearchQuery(aliases), variables: { ...queries, first: limit } }),
    });
    const body = await this.readBody(response);
    const errors = body.errors ?? [];
    const blocking = blockingProblem(errors);
    if (blocking) throw blocking;
    const data = body.data;
    if (!data) throw new Error(errors[0]?.message ?? 'Resposta do GitHub sem dados.');
    const result = {} as Record<K, PullRequestList>;
    for (const alias of aliases) {
      const search = data[alias];
      const items = (search?.nodes ?? []).flatMap((node) => toPullRequest(node) ?? []);
      result[alias] = { items, total: search?.issueCount ?? items.length };
    }
    return result;
  }

  private async readBody(response: Response): Promise<GraphqlResponse> {
    if (response.status === 401) throw new ConnectionProblemError('github-unauthorized');
    if (response.status === 403) {
      if (response.headers.get('x-github-sso') !== null) throw new ConnectionProblemError('github-org-access');
      if (response.headers.get('x-ratelimit-remaining') === '0') throw new Error(RATE_LIMIT_MESSAGE);
      const detail = await response.json().catch(() => ({}) as GraphqlResponse);
      if (/SAML|SSO/i.test((detail as GraphqlResponse).message ?? '')) throw new ConnectionProblemError('github-org-access');
      throw new Error('GitHub respondeu 403.');
    }
    if (!response.ok) throw new Error(`GitHub respondeu ${response.status} em /graphql`);
    return (await response.json()) as GraphqlResponse;
  }
}
