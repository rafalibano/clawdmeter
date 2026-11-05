import { describe, expect, it } from 'vitest';
import { createFakeFetch, type FakeResponse } from '../testing/fakes';
import { GitHubGraphqlGateway, buildSearchQuery, toPullRequest } from './github-graphql-gateway';

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

function gateway(reply: FakeResponse) {
  const { fetcher, requests } = createFakeFetch(() => reply);
  return { gateway: new GitHubGraphqlGateway(fetcher), requests };
}

describe('GitHubGraphqlGateway', () => {
  it('faz um POST em /graphql com token, queries como variáveis e limite', async () => {
    const { gateway: gql, requests } = gateway({
      json: { data: { mine: { issueCount: 1, nodes: [NODE] } } },
    });
    const result = await gql.search('tok', { mine: 'author:@me is:open is:pr' }, 50);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: 'https://api.github.com/graphql', method: 'POST' });
    expect(requests[0]?.headers['Authorization']).toBe('Bearer tok');
    const body = JSON.parse(requests[0]?.body ?? '{}') as { query: string; variables: Record<string, unknown> };
    expect(body.variables).toEqual({ mine: 'author:@me is:open is:pr', first: 50 });
    expect(body.query).toContain('mine: search(query: $mine');
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

  it('várias buscas numa só requisição e issueCount maior que o limite', async () => {
    const { gateway: gql, requests } = gateway({
      json: {
        data: {
          toReview: { issueCount: 120, nodes: [NODE, null, {}] },
          reviewed: { issueCount: 0, nodes: [] },
        },
      },
    });
    const result = await gql.search('t', { toReview: 'a', reviewed: 'b' }, 50);
    expect(requests).toHaveLength(1);
    expect(result.toReview.items).toHaveLength(1);
    expect(result.toReview.total).toBe(120);
    expect(result.reviewed).toEqual({ items: [], total: 0 });
  });

  it('mapeia estados ausentes para none/unknown/open', () => {
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

  it('403 com header SSO e 403 com mensagem SAML viram github-org-access', async () => {
    const sso = gateway({ status: 403, headers: { 'x-github-sso': 'required; url=https://github.com/orgs/x/sso' } });
    await expect(sso.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-org-access' });
    const saml = gateway({ status: 403, json: { message: 'Resource protected by organization SAML enforcement.' } });
    await expect(saml.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-org-access' });
  });

  it('403 com limite zerado e demais status são erros comuns', async () => {
    const limited = gateway({ status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    await expect(limited.gateway.search('t', { mine: 'q' }, 10)).rejects.toThrow('Limite de requisições');
    const forbidden = gateway({ status: 403 });
    await expect(forbidden.gateway.search('t', { mine: 'q' }, 10)).rejects.toThrow('403');
    const down = gateway({ status: 502 });
    await expect(down.gateway.search('t', { mine: 'q' }, 10)).rejects.toThrow('502');
  });

  it('erros GraphQL de escopo e de SAML viram problemas de conexão', async () => {
    const scope = gateway({ json: { errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'Your token has not been granted the required scopes' }] } });
    await expect(scope.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-missing-scope' });
    const saml = gateway({
      json: { data: { mine: { issueCount: 0, nodes: [] } }, errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement' }] },
    });
    await expect(saml.gateway.search('t', { mine: 'q' }, 10)).rejects.toMatchObject({ problem: 'github-org-access' });
  });

  it('outros erros GraphQL e resposta sem dados sobem como erro comum', async () => {
    const other = gateway({ json: { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] } });
    await expect(other.gateway.search('t', { mine: 'q' }, 10)).rejects.toThrow('API rate limit exceeded');
    const empty = gateway({ json: {} });
    await expect(empty.gateway.search('t', { mine: 'q' }, 10)).rejects.toThrow('sem dados');
  });

  it('recusa alias inválido antes de montar a query', () => {
    expect(() => buildSearchQuery(['ok', 'bad alias'])).toThrow('Alias de busca inválido');
  });
});
