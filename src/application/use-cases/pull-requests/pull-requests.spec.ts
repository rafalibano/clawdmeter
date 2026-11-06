import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectionProblemError, FIX_FOR } from '../../../domain/connections';
import type { PullRequest } from '../../../domain/pull-requests';
import { GitHubTokenResolver } from '../../connections/github-token-resolver';
import { createPullRequests, type PullRequests } from '../../pull-requests';
import { FakeClock } from '../../testing/fake-clock';
import { FakeConnectionPrefsStore, FakeGitHubCli, FakeSecretStore, FakeUrlOpener } from '../../testing/fake-connection-adapters';
import { FakePullRequestGateway } from '../../testing/fake-pull-request-gateway';
import { SECRET_KEYS } from '../../ports';
import { PULL_REQUEST_LIMIT } from './load-my-pull-requests';
import { OpenGitHubUrl } from './open-github-url';

function pr(id: string, repo: string, overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id,
    number: 1,
    title: id,
    url: `https://github.com/${repo}/pull/1`,
    repo,
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

let prefs: FakeConnectionPrefsStore;
let cli: FakeGitHubCli;
let secrets: FakeSecretStore;
let gateway: FakePullRequestGateway;
let features: PullRequests;
let clock: FakeClock;

beforeEach(async () => {
  prefs = new FakeConnectionPrefsStore();
  prefs.current = { ...prefs.current, github: { method: 'gh-cli' } };
  cli = new FakeGitHubCli();
  secrets = new FakeSecretStore();
  gateway = new FakePullRequestGateway();
  clock = new FakeClock();
  await clock.advance(Date.UTC(2026, 10, 5));
  features = createPullRequests({ prefs, tokens: new GitHubTokenResolver(cli, secrets), gateway }, clock);
});

describe('PRs', () => {
  it('fetches the user open PRs and groups by repo, with Deploy collapsed', async () => {
    gateway.lists.set('mine', {
      items: [pr('a', 'acme/api'), pr('b', 'acme/k8s'), pr('c', 'acme/api')],
      total: 3,
    });
    const data = await features.loadMine.execute();
    expect(gateway.calls).toEqual([
      {
        token: 'gh-token',
        queries: {
          mine: 'author:@me is:open is:pr archived:false sort:updated-desc',
          assigned: 'assignee:@me -author:@me is:open is:pr archived:false sort:updated-desc',
        },
        limit: PULL_REQUEST_LIMIT,
      },
    ]);
    const [section] = data.sections;
    expect(section).toMatchObject({ id: 'mine', shown: 3, total: 3, showAuthor: false });
    expect(section?.groups.map((group) => [group.title, group.collapsedByDefault])).toEqual([
      ['acme/api', false],
      ['Deploy', true],
    ]);
  });

  it('returns the mine and assigned sections in order, with the author shown only on assigned', async () => {
    gateway.lists.set('mine', { items: [pr('m1', 'acme/api')], total: 1 });
    gateway.lists.set('assigned', { items: [pr('a1', 'acme/web'), pr('a2', 'acme/k8s')], total: 7 });
    const data = await features.loadMine.execute();
    expect(data.sections.map((section) => [section.id, section.shown, section.total, section.showAuthor])).toEqual([
      ['mine', 1, 1, false],
      ['assigned', 2, 7, true],
    ]);
    expect(data.sections[1]?.searchUrl).toContain(encodeURIComponent('assignee:@me -author:@me'));
    expect(data.sections[1]?.groups.map((group) => group.title)).toEqual(['acme/web', 'Deploy']);
  });

  it('keeps an empty assigned section when nothing is assigned', async () => {
    gateway.lists.set('mine', { items: [pr('m1', 'acme/api')], total: 1 });
    const data = await features.loadMine.execute();
    expect(data.sections[1]).toMatchObject({ id: 'assigned', groups: [], shown: 0, total: 0, showAuthor: true });
  });

  it('uses the PAT from the keychain when the method is not gh-cli', async () => {
    prefs.current = { ...prefs.current, github: { method: 'pat' } };
    secrets.values.set(SECRET_KEYS.githubToken, 'ghp_cofre');
    await features.loadMine.execute();
    expect(gateway.calls[0]?.token).toBe('ghp_cofre');
  });

  it('without a GitHub connection becomes a github-unauthorized problem with instructions', async () => {
    prefs.current = { ...prefs.current, github: { method: null } };
    await expect(features.loadMine.execute()).rejects.toMatchObject({
      problem: 'github-unauthorized',
      code: 'github-not-connected',
    });
    expect(gateway.calls).toHaveLength(0);
  });

  it('a token missing from the CLI becomes github-unauthorized', async () => {
    cli.outcome = { missing: 'not-logged-in' };
    await expect(features.loadMine.execute()).rejects.toMatchObject({ problem: 'github-unauthorized' });
  });

  it('propagates gateway problems, each with a fix button', async () => {
    for (const problem of ['github-unauthorized', 'github-missing-scope', 'github-org-access'] as const) {
      gateway.outcome = new ConnectionProblemError(problem);
      const error = await features.loadMine.execute().catch((caught: unknown) => caught);
      expect(error).toMatchObject({ problem });
      expect(FIX_FOR[problem]).not.toBe('retry');
    }
  });
});

describe('Reviews', () => {
  it('builds the three searches and merges open reviewed ones with those from the last 30 days', async () => {
    gateway.lists.set('toReview', { items: [pr('t1', 'acme/web')], total: 1 });
    gateway.lists.set('reviewedOpen', { items: [pr('o1', 'acme/api'), pr('shared', 'acme/api')], total: 2 });
    gateway.lists.set('reviewedRecent', {
      items: [pr('shared', 'acme/api'), pr('r1', 'acme/k8s-prod', { state: 'merged' })],
      total: 2,
    });
    const data = await features.loadReviews.execute();
    expect(gateway.calls[0]?.queries).toEqual({
      toReview: 'review-requested:@me is:open is:pr archived:false sort:updated-desc',
      reviewedOpen: 'reviewed-by:@me -author:@me is:open is:pr archived:false sort:updated-desc',
      reviewedRecent: 'reviewed-by:@me -author:@me is:pr archived:false is:closed closed:>=2026-10-06 sort:updated-desc',
    });
    const [toReview, reviewed] = data.sections;
    expect(toReview).toMatchObject({ id: 'to-review', shown: 1, total: 1, showAuthor: true });
    expect(reviewed).toMatchObject({ id: 'reviewed', shown: 3, total: 4, showAuthor: true });
    expect(reviewed?.searchUrl).toContain(encodeURIComponent('(is:open OR closed:>=2026-10-06)'));
    expect(reviewed?.groups.map((group) => group.title)).toEqual(['acme/api', 'Deploy']);
    expect(reviewed?.groups[1]?.collapsedByDefault).toBe(true);
  });

  it('without results returns empty sections', async () => {
    const data = await features.loadReviews.execute();
    expect(data.sections.map((section) => section.groups)).toEqual([[], []]);
  });
});

describe('OpenGitHubUrl', () => {
  it('opens https links on github.com', async () => {
    const opener = new FakeUrlOpener();
    await new OpenGitHubUrl(opener).execute('https://github.com/acme/api/pull/1');
    await new OpenGitHubUrl(opener).execute('https://github.com/pulls?q=a%3Ab');
    expect(opener.opened).toEqual(['https://github.com/acme/api/pull/1', 'https://github.com/pulls?q=a%3Ab']);
  });

  it.each([
    'http://github.com/acme/api/pull/1',
    'https://evil.example/acme/api/pull/1',
    'https://github.com.evil.example/x',
    'https://user@github.com/x',
    'https://github.com:8443/x',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'nao-e-url',
  ])('rejects %s without opening anything', async (url) => {
    const opener = new FakeUrlOpener();
    await expect(new OpenGitHubUrl(opener).execute(url)).rejects.toThrow('link-invalid-github');
    expect(opener.opened).toEqual([]);
  });
});
