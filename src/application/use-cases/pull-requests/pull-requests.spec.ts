import { beforeEach, describe, expect, it } from 'vitest';
import { ConnectionProblemError, FIX_FOR, FIX_LABELS } from '../../../domain/connections';
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
  it('busca os PRs abertos do usuário e agrupa por repo, com Deploy recolhido', async () => {
    gateway.lists.set('mine', {
      items: [pr('a', 'acme/api'), pr('b', 'acme/k8s'), pr('c', 'acme/api')],
      total: 3,
    });
    const data = await features.loadMine.execute();
    expect(gateway.calls).toEqual([
      { token: 'gh-token', queries: { mine: 'author:@me is:open is:pr archived:false sort:updated-desc' }, limit: PULL_REQUEST_LIMIT },
    ]);
    const [section] = data.sections;
    expect(section).toMatchObject({ id: 'mine', shown: 3, total: 3 });
    expect(section?.groups.map((group) => [group.title, group.collapsedByDefault])).toEqual([
      ['acme/api', false],
      ['Deploy', true],
    ]);
  });

  it('usa o PAT do cofre quando o método não é gh-cli', async () => {
    prefs.current = { ...prefs.current, github: { method: 'pat' } };
    secrets.values.set(SECRET_KEYS.githubToken, 'ghp_cofre');
    await features.loadMine.execute();
    expect(gateway.calls[0]?.token).toBe('ghp_cofre');
  });

  it('sem conexão GitHub vira problema github-unauthorized com instrução', async () => {
    prefs.current = { ...prefs.current, github: { method: null } };
    await expect(features.loadMine.execute()).rejects.toMatchObject({
      problem: 'github-unauthorized',
      message: expect.stringContaining('Conexões'),
    });
    expect(gateway.calls).toHaveLength(0);
  });

  it('token ausente no CLI vira github-unauthorized', async () => {
    cli.outcome = { missing: 'not-logged-in' };
    await expect(features.loadMine.execute()).rejects.toMatchObject({ problem: 'github-unauthorized' });
  });

  it('propaga problemas do gateway, cada um com botão de conserto', async () => {
    for (const problem of ['github-unauthorized', 'github-missing-scope', 'github-org-access'] as const) {
      gateway.outcome = new ConnectionProblemError(problem);
      const error = await features.loadMine.execute().catch((caught: unknown) => caught);
      expect(error).toMatchObject({ problem });
      expect(FIX_LABELS[FIX_FOR[problem]]).not.toBe('');
    }
  });
});

describe('Reviews', () => {
  it('monta as três buscas e junta revisados abertos com os dos últimos 30 dias', async () => {
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
    expect(toReview).toMatchObject({ id: 'to-review', shown: 1, total: 1 });
    expect(reviewed).toMatchObject({ id: 'reviewed', shown: 3, total: 4 });
    expect(reviewed?.searchUrl).toContain(encodeURIComponent('(is:open OR closed:>=2026-10-06)'));
    expect(reviewed?.groups.map((group) => group.title)).toEqual(['acme/api', 'Deploy']);
    expect(reviewed?.groups[1]?.collapsedByDefault).toBe(true);
  });

  it('sem resultados devolve seções vazias', async () => {
    const data = await features.loadReviews.execute();
    expect(data.sections.map((section) => section.groups)).toEqual([[], []]);
  });
});

describe('OpenGitHubUrl', () => {
  it('abre links https de github.com', async () => {
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
  ])('recusa %s sem abrir nada', async (url) => {
    const opener = new FakeUrlOpener();
    await expect(new OpenGitHubUrl(opener).execute(url)).rejects.toThrow('inválido');
    expect(opener.opened).toEqual([]);
  });
});
