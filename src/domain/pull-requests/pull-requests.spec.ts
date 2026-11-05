import { describe, expect, it } from 'vitest';
import { formatAge } from './age';
import { DEPLOY_GROUP_KEY, groupByRepo, isDeployRepo, mergeUnique } from './grouping';
import { isTruncated, type PullRequest } from './pull-request';
import { MINE_QUERY, REVIEWED_OPEN_QUERY, TO_REVIEW_QUERY, reviewedAllQuery, reviewedRecentQuery, searchPageUrl } from './search';

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    id: 'PR_1',
    number: 1,
    title: 'Title',
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
  it('groups by repo in alphabetical order, most recent first', () => {
    const groups = groupByRepo([
      pr({ id: 'a', repo: 'acme/web', updatedAt: 1 }),
      pr({ id: 'b', repo: 'acme/api', updatedAt: 1 }),
      pr({ id: 'c', repo: 'acme/api', updatedAt: 5 }),
    ]);
    expect(groups.map((group) => group.title)).toEqual(['acme/api', 'acme/web']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['c', 'b']);
    expect(groups.every((group) => !group.collapsedByDefault)).toBe(true);
  });

  it('sends k8s and k8s-prod to the Deploy group, collapsed and last', () => {
    const groups = groupByRepo([
      pr({ id: 'a', repo: 'acme/k8s' }),
      pr({ id: 'b', repo: 'acme/zeta' }),
      pr({ id: 'c', repo: 'acme/k8s-prod' }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(['acme/zeta', DEPLOY_GROUP_KEY]);
    expect(groups[1]).toMatchObject({ title: 'Deploy', collapsedByDefault: true });
    expect(groups[1]?.items).toHaveLength(2);
  });

  it('without PRs returns an empty list', () => {
    expect(groupByRepo([])).toEqual([]);
  });

  it('only treats the exact repo name as deploy', () => {
    expect(isDeployRepo('acme/k8s')).toBe(true);
    expect(isDeployRepo('acme/k8s-prod')).toBe(true);
    expect(isDeployRepo('acme/k8s-tools')).toBe(false);
  });
});

describe('mergeUnique', () => {
  it('keeps the first occurrence of each id', () => {
    const merged = mergeUnique([pr({ id: 'a', title: 'one' })], [pr({ id: 'a', title: 'two' }), pr({ id: 'b' })]);
    expect(merged.map((item) => item.title)).toEqual(['one', 'Title']);
  });
});

describe('busca', () => {
  it('builds the 30 day window of the reviewed search', () => {
    const now = Date.UTC(2026, 10, 5, 12);
    expect(reviewedRecentQuery(now)).toBe(
      'reviewed-by:@me -author:@me is:pr archived:false is:closed closed:>=2026-10-06 sort:updated-desc',
    );
  });

  it('the "See all" link of the reviewed ones covers open and closed from the last 30 days', () => {
    const now = Date.UTC(2026, 10, 5, 12);
    expect(reviewedAllQuery(now)).toBe(
      'reviewed-by:@me -author:@me is:pr archived:false (is:open OR closed:>=2026-10-06) sort:updated-desc',
    );
  });

  it('the four searches sort by most recently updated', () => {
    const now = Date.UTC(2026, 10, 5, 12);
    for (const query of [MINE_QUERY, TO_REVIEW_QUERY, REVIEWED_OPEN_QUERY, reviewedRecentQuery(now)]) {
      expect(query.endsWith(' sort:updated-desc')).toBe(true);
    }
  });

  it('builds the GitHub search link', () => {
    expect(searchPageUrl('author:@me is:open')).toBe('https://github.com/pulls?q=author%3A%40me%20is%3Aopen');
  });

  it('detects a truncated list', () => {
    expect(isTruncated({ items: [pr({})], total: 3 })).toBe(true);
    expect(isTruncated({ items: [pr({})], total: 1 })).toBe(false);
  });
});

describe('formatAge', () => {
  it('formats in min, h and d', () => {
    expect(formatAge(0, 30_000)).toBe('1 min');
    expect(formatAge(0, 5 * 60_000)).toBe('5 min');
    expect(formatAge(0, 3 * 3_600_000)).toBe('3 h');
    expect(formatAge(0, 4 * 86_400_000)).toBe('4 d');
    expect(formatAge(10, 0)).toBe('1 min');
  });
});
