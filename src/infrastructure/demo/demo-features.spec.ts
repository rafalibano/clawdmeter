import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubTokenResolver } from '../../application/connections/github-token-resolver';
import { createConnections } from '../../application/connections/create-connections';
import { createPullRequests } from '../../application/pull-requests';
import { FakeTranslator } from '../../application/testing/fake-translator';
import { createSkills } from '../../application/skills';
import { FakeClock } from '../../application/testing/fake-clock';
import { FIX_FOR } from '../../domain/connections';
import { RUN_FIX_FOR } from '../../domain/skills';
import { createDemoConnectionAdapters } from './demo-adapters';
import { DemoPullRequestGateway } from './demo-pull-requests';
import { DemoNotifier, createDemoSkillAdapters } from './demo-skills';
import { createDemoWorld } from './demo-world';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(search: string) {
  const world = createDemoWorld(search);
  const clock = new FakeClock();
  const adapters = createDemoConnectionAdapters(world);
  const connections = createConnections(adapters, clock);
  const pullRequests = createPullRequests(
    {
      prefs: adapters.prefs,
      tokens: new GitHubTokenResolver(adapters.githubCli, adapters.secrets),
      gateway: new DemoPullRequestGateway(world),
    },
    clock,
  );
  const skills = createSkills(
    createDemoSkillAdapters(world, { terminal: adapters.terminal, urls: adapters.urlOpener, notifier: new DemoNotifier(), translator: new FakeTranslator() }),
    clock,
    connections,
  );
  return { world, connections, pullRequests, skills };
}

async function settle<T>(work: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return work;
}

describe('demo: PRs e Reviews', () => {
  it('com GitHub conectado mostra dados genéricos, com Deploy recolhido', async () => {
    const { pullRequests } = setup('?demo=github:ok');
    const mine = await settle(pullRequests.loadMine.execute());
    const titles = mine.sections[0]?.groups.map((group) => group.title);
    expect(titles).toEqual(['acme/api', 'acme/mobile', 'acme/web', 'Deploy']);
    expect(mine.sections[0]?.groups.at(-1)?.collapsedByDefault).toBe(true);

    const reviews = await settle(pullRequests.loadReviews.execute());
    expect(reviews.sections.map((section) => section.id)).toEqual(['to-review', 'reviewed']);
    expect(reviews.sections[1]?.groups.some((group) => group.title === 'Deploy')).toBe(true);
  });

  it('nunca expõe nomes reais de org', async () => {
    const { pullRequests } = setup('?demo=github:ok');
    const mine = await settle(pullRequests.loadMine.execute());
    const reviews = await settle(pullRequests.loadReviews.execute());
    const everything = JSON.stringify([mine, reviews]);
    expect(everything).not.toMatch(/mottu/i);
  });

  it('sem GitHub conectado pede para conectar', async () => {
    const { pullRequests } = setup('');
    await expect(pullRequests.loadMine.execute()).rejects.toMatchObject({ problem: 'github-unauthorized' });
  });

  it.each([
    ['github:github-unauthorized', 'github-unauthorized'],
    ['github:github-missing-scope', 'github-missing-scope'],
    ['github:github-org-access', 'github-org-access'],
  ] as const)('?demo=%s falha com %s e o botão de conserto resolve', async (scenario, problem) => {
    const { connections, pullRequests } = setup(`?demo=${scenario}`);
    const failure = pullRequests.loadMine.execute().catch((error: unknown) => error);
    expect(await settle(failure)).toMatchObject({ problem });
    await settle(connections.fix.execute('github', FIX_FOR[problem]));
    expect((await settle(pullRequests.loadMine.execute())).sections[0]?.shown).toBeGreaterThan(0);
  });
});

describe('demo: runs de skills', () => {
  it('simula uma run com stream e conclui com custo e sessão', async () => {
    const { skills } = setup('');
    const { run, finished } = await skills.run.execute('acabativa');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(skills.board.get(run.id)?.status).toBe('running');
    expect(skills.board.get(run.id)?.log.length).toBeGreaterThan(0);
    await vi.runAllTimersAsync();
    expect(await finished).toMatchObject({ status: 'succeeded', costUsd: 0.1234, problem: null });
  });

  it('cancelar interrompe o stream simulado', async () => {
    const { skills } = setup('');
    const { run, finished } = await skills.run.execute('acabativa');
    await vi.advanceTimersByTimeAsync(800);
    await skills.cancel.execute(run.id);
    expect((await finished).status).toBe('cancelled');
  });

  it('?demo=skills:mcp-needs-auth mostra o problema e Reconectar MCP resolve', async () => {
    const { skills } = setup('?demo=skills:mcp-needs-auth');
    const first = await skills.run.execute('acabativa');
    await vi.runAllTimersAsync();
    const failed = await first.finished;
    expect(failed).toMatchObject({ status: 'failed', problem: 'mcp-unauthenticated' });
    await skills.fix.execute(RUN_FIX_FOR['mcp-unauthenticated']);
    const second = await skills.run.execute('acabativa');
    await vi.runAllTimersAsync();
    expect(await second.finished).toMatchObject({ status: 'succeeded', problem: null });
  });

  it('?demo=skills:claude-code-missing mostra o problema e Instalar resolve', async () => {
    const { skills } = setup('?demo=skills:claude-code-missing');
    const first = await skills.run.execute('acabativa');
    expect(await first.finished).toMatchObject({ status: 'failed', problem: 'claude-code-missing' });
    await skills.fix.execute(RUN_FIX_FOR['claude-code-missing']);
    const second = await skills.run.execute('acabativa');
    await vi.runAllTimersAsync();
    expect((await second.finished).status).toBe('succeeded');
  });

  it('Continuar no terminal funciona na run simulada', async () => {
    const { skills, world } = setup('');
    const { run, finished } = await skills.run.execute('resumo-prs');
    await vi.runAllTimersAsync();
    await finished;
    await expect(skills.continueInTerminal.execute(run.id)).resolves.toBeUndefined();
    expect(world.skills.mcpNeedsAuth).toBe(false);
  });
});
