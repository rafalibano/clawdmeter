import { describe, expect, it } from 'vitest';
import { formatAge } from './age';
import { DEPLOY_GROUP_KEY, groupByRepo, isDeployRepo, mergeUnique } from './grouping';
import { isTruncated, type PullRequest } from './pull-request';
import { reviewedRecentQuery, searchPageUrl } from './search';

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    id: 'PR_1',
    number: 1,
    title: 'Título',
    url: 'https://github.com/acme/api/pull/1',
    repo: 'acme/api',
    author: 'ana',
    state: 'open',
    isDraft: false,
    ci: 'none',
    review: 'none',
    merge: 'unknown',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('groupByRepo', () => {
  it('agrupa por repo em ordem alfabética, mais recente primeiro', () => {
    const groups = groupByRepo([
      pr({ id: 'a', repo: 'acme/web', updatedAt: 1 }),
      pr({ id: 'b', repo: 'acme/api', updatedAt: 1 }),
      pr({ id: 'c', repo: 'acme/api', updatedAt: 5 }),
    ]);
    expect(groups.map((group) => group.title)).toEqual(['acme/api', 'acme/web']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['c', 'b']);
    expect(groups.every((group) => !group.collapsedByDefault)).toBe(true);
  });

  it('manda k8s e k8s-prod para o grupo Deploy, recolhido e por último', () => {
    const groups = groupByRepo([
      pr({ id: 'a', repo: 'acme/k8s' }),
      pr({ id: 'b', repo: 'acme/zeta' }),
      pr({ id: 'c', repo: 'acme/k8s-prod' }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(['acme/zeta', DEPLOY_GROUP_KEY]);
    expect(groups[1]).toMatchObject({ title: 'Deploy', collapsedByDefault: true });
    expect(groups[1]?.items).toHaveLength(2);
  });

  it('sem PRs devolve lista vazia', () => {
    expect(groupByRepo([])).toEqual([]);
  });

  it('só considera deploy o nome exato do repo', () => {
    expect(isDeployRepo('acme/k8s')).toBe(true);
    expect(isDeployRepo('acme/k8s-prod')).toBe(true);
    expect(isDeployRepo('acme/k8s-tools')).toBe(false);
  });
});

describe('mergeUnique', () => {
  it('mantém a primeira ocorrência de cada id', () => {
    const merged = mergeUnique([pr({ id: 'a', title: 'um' })], [pr({ id: 'a', title: 'dois' }), pr({ id: 'b' })]);
    expect(merged.map((item) => item.title)).toEqual(['um', 'Título']);
  });
});

describe('busca', () => {
  it('monta a janela de 30 dias da busca de revisados', () => {
    const now = Date.UTC(2026, 10, 5, 12);
    expect(reviewedRecentQuery(now)).toBe('reviewed-by:@me -author:@me is:pr is:closed closed:>=2026-10-06');
  });

  it('monta o link da busca no GitHub', () => {
    expect(searchPageUrl('author:@me is:open')).toBe('https://github.com/pulls?q=author%3A%40me%20is%3Aopen');
  });

  it('detecta lista truncada', () => {
    expect(isTruncated({ items: [pr({})], total: 3 })).toBe(true);
    expect(isTruncated({ items: [pr({})], total: 1 })).toBe(false);
  });
});

describe('formatAge', () => {
  it('formata em min, h e d', () => {
    expect(formatAge(0, 30_000)).toBe('1 min');
    expect(formatAge(0, 5 * 60_000)).toBe('5 min');
    expect(formatAge(0, 3 * 3_600_000)).toBe('3 h');
    expect(formatAge(0, 4 * 86_400_000)).toBe('4 d');
    expect(formatAge(10, 0)).toBe('1 min');
  });
});
