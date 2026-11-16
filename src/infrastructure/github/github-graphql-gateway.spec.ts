import { describe, expect, it } from 'vitest';
import { createFakeFetch, type FakeResponse } from '../testing/fakes';
import { GitHubGraphqlGateway, toPullRequest } from './github-graphql-gateway';

const NODE = {
  id: 'PR_1',
  number: 12,
  title: 'feat: nova rota',
  url: 'https://github.com/acme/api/pull/12',
  isDraft: false,
  state: 'OPEN',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-04T10:00:00Z',
  mergeable: 'CONFLICTING',
  reviewDecision: 'CHANGES_REQUESTED',
  author: { login: 'ana' },
  repository: { nameWithOwner: 'acme/api' },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
};

interface Sent {
  query: string;
  variables: { query: string; first: number; after: string | null };
}

const sent = (body: string | undefined) => JSON.parse(body ?? '{}') as Sent;

function gateway(reply: FakeResponse | ((variables: Sent['variables']) => FakeResponse)) {
  const { fetcher, requests } = createFakeFetch((request) => (typeof reply === 'function' ? reply(sent(request.body).variables) : reply));
  return { gateway: new GitHubGraphqlGateway(fetcher), requests };
}

describe('GitHubGraphqlGateway', () => {
  it('sends a POST to /graphql with the token and the search as a variable', async () => {
    const { gateway: gql, requests } = gateway({
      json: { data: { search: { issueCount: 1, nodes: [NODE] } } },
    });
    const result = await gql.search('tok', { mine: 'author:@me is:open is:pr' }, 50);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: 'https://api.github.com/graphql', method: 'POST' });
    expect(requests[0]?.headers['Authorization']).toBe('Bearer tok');
    const body = sent(requests[0]?.body);
    expect(body.variables).toEqual({ query: 'author:@me is:open is:pr', first: 25, after: null });
    expect(body.query).toContain('search(query: $query');
    expect(result.mine).toEqual({
      total: 1,
      items: [
        {
          id: 'PR_1',
          number: 12,
          title: 'feat: nova rota',
          url: 'https://github.com/acme/api/pull/12',
          repo: 'acme/api',
          author: 'ana',
          state: 'open',
          isDraft: false,
          ci: 'failure',
          review: 'changes-requested',
          merge: 'conflicting',
          createdAt: Date.parse('2026-11-01T10:00:00Z'),
          updatedAt: Date.parse('2026-11-04T10:00:00Z'),
        },
      ],
    });
  });

  it('one request per search, and an issueCount above the limit', async () => {
    const { gateway: gql, requests } = gateway(({ query }) => ({
      json: { data: { search: query === 'a' ? { issueCount: 120, nodes: [NODE, null, {}] } : { issueCount: 0, nodes: [] } } },
    }));
    const result = await gql.search('t', { toReview: 'a', reviewed: 'b' }, 50);
    expect(requests.map((request) => sent(request.body).variables.query).sort()).toEqual(['a', 'b']);
    expect(result.toReview.items).toHaveLength(1);
    expect(result.toReview.total).toBe(120);
    expect(result.reviewed).toEqual({ items: [], total: 0 });
  });

  it('follows the cursor in pages of 25 until the limit', async () => {
    const pageOf = (count: number, from: number) => Array.from({ length: count }, (_, index) => ({ ...NODE, id: `PR_${from + index}` }));
    const { gateway: gql, requests } = gateway(({ first, after }) => ({
      json: {
        data: {
          search: {
            issueCount: 271,
            pageInfo: { hasNextPage: true, endCursor: after === null ? 'c1' : 'c2' },
            nodes: pageOf(first, after === null ? 0 : after === 'c1' ? 25 : 50),
          },
        },
      },
    }));
    const result = await gql.search('t', { toReview: 'a' }, 60);
    expect(requests.map((request) => sent(request.body).variables)).toEqual([
      { query: 'a', first: 25, after: null },
      { query: 'a', first: 25, after: 'c1' },
      { query: 'a', first: 10, after: 'c2' },
    ]);
    expect(result.toReview.items).toHaveLength(60);
    expect(new Set(result.toReview.items.map((item) => item.id)).size).toBe(60);
    expect(result.toReview.total).toBe(271);
  });

  it('stops when there is no next page', async () => {
    const { gateway: gql, requests } = gateway({
      json: { data: { search: { issueCount: 1, pageInfo: { hasNextPage: false, endCursor: 'c1' }, nodes: [NODE] } } },
    });
    await gql.search('t', { mine: 'q' }, 50);
    expect(requests).toHaveLength(1);
  });

  it('maps missing states to none/unknown/open', () => {
    const pr = toPullRequest({ ...NODE, commits: { nodes: [] }, reviewDecision: null, mergeable: 'UNKNOWN', state: 'MERGED', isDraft: true, author: null });
    expect(pr).toMatchObject({ ci: 'none', review: 'none', merge: 'unknown', state: 'merged', isDraft: true, author: 'ghost' });
    expect(toPullRequest({ ...NODE, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] } })?.ci).toBe('pending');
    expect(toPullRequest({ ...NODE, reviewDecision: 'APPROVED', mergeable: 'MERGEABLE' })).toMatchObject({ review: 'approved', merge: 'mergeable' });
    expect(toPullRequest(null)).toBeNull();
  });

  it('401 vira github-unauthorized', async () => {
    const { gateway: gql } = gateway({ status: 401, json: { message: 'Bad credentials' } });
    await expect(gql.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-unauthorized' });
  });

  it('403 with an SSO header and 403 with a SAML message become github-org-access', async () => {
    const sso = gateway({ status: 403, headers: { 'x-github-sso': 'required; url=https://github.com/orgs/x/sso' } });
    await expect(sso.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-org-access' });
    const saml = gateway({ status: 403, json: { message: 'Resource protected by organization SAML enforcement.' } });
    await expect(saml.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-org-access' });
  });

  it('403 with an exhausted limit and other statuses are plain errors', async () => {
    const limited = gateway({ status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    await expect(limited.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ code: 'github-rate-limited' });
    const forbidden = gateway({ status: 403 });
    await expect(forbidden.gateway.search('t', { mine: 'q' }, 10)).rejects.toThrow('403');
    const down = gateway({ status: 502 });
    await expect(down.gateway.search('t', { mine: 'q' }, 10)).rejects.toThrow('502');
  });

  it('GraphQL scope and SAML errors become connection problems', async () => {
    const scope = gateway({ json: { errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'Your token has not been granted the required scopes' }] } });
    await expect(scope.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-missing-scope' });
    const saml = gateway({
      json: { data: { search: { issueCount: 0, nodes: [] } }, errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement' }] },
    });
    await expect(saml.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-org-access' });
  });

  it('RATE_LIMITED becomes a clear coded error', async () => {
    const limited = gateway({ json: { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] } });
    await expect(limited.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ code: 'github-rate-limited' });
  });

  it('an error without data and an empty response surface as a plain error', async () => {
    const other = gateway({ json: { errors: [{ type: 'INTERNAL', message: 'Algo quebrou' }] } });
    await expect(other.gateway.search('t', { mine: 'q' }, 10)).rejects.toThrow('Algo quebrou');
    const empty = gateway({ json: {} });
    await expect(empty.gateway.search('t', { mine: 'q' }, 10)).rejects.toThrow('without data');
  });

  it('partial data with a plain error uses the valid nodes', async () => {
    const partial = gateway(({ query }) => ({
      json: {
        data: { search: query === 'q' ? { issueCount: 2, nodes: [NODE, null, { id: 'quebrado' }] } : null },
        errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a node' }],
      },
    }));
    const result = await partial.gateway.search('t', { mine: 'q', other: 'r' }, 10);
    expect(result.mine.items.map((item) => item.id)).toEqual(['PR_1']);
    expect(result.other).toEqual({ items: [], total: 0 });
  });

  it('partial data with scope or SAML still throws the connection problem', async () => {
    const scope = gateway({
      json: { data: { search: { issueCount: 1, nodes: [NODE] } }, errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'x' }] },
    });
    await expect(scope.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-missing-scope' });
    const saml = gateway({
      json: { data: { search: null }, errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement' }] },
    });
    await expect(saml.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-org-access' });
  });
});
