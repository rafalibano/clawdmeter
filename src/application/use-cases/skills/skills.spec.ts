import { beforeEach, describe, expect, it } from 'vitest';
import { CLAUDE_CODE_INSTALL_URL, ConnectionProblemError } from '../../../domain/connections';
import {
  DEFAULT_ALLOWED_TOOLS,
  FIXTURE_SESSION_ID,
  MCP_NEEDS_AUTH_STREAM,
  NOISY_STREAM,
  SUCCESS_STREAM,
  parseSkillsConfig,
  type SkillRun,
} from '../../../domain/skills';
import { createConnections } from '../../connections/create-connections';
import { FakeTranslator } from '../../testing/fake-translator';
import { createSkills, type Skills } from '../../skills';
import { FakeClock } from '../../testing/fake-clock';
import { FakeTerminal, FakeUrlOpener, createFakeConnectionWorld } from '../../testing/fake-connection-adapters';
import {
  FakeNotifier,
  FakeSkillRunStore,
  FakeSkillsConfigStore,
  FakeStreamingProcessRunner,
} from '../../testing/fake-feature-adapters';

let runner: FakeStreamingProcessRunner;
let store: FakeSkillRunStore;
let terminal: FakeTerminal;
let urls: FakeUrlOpener;
let clock: FakeClock;
let skills: Skills;
let notifier: FakeNotifier;
let world: ReturnType<typeof createFakeConnectionWorld>;
let connections: ReturnType<typeof createConnections>;

beforeEach(async () => {
  runner = new FakeStreamingProcessRunner();
  store = new FakeSkillRunStore();
  terminal = new FakeTerminal();
  urls = new FakeUrlOpener();
  clock = new FakeClock();
  await clock.advance(1_000_000);
  notifier = new FakeNotifier();
  world = createFakeConnectionWorld();
  connections = createConnections(world.adapters, clock);
  await connections.check.execute('notifications');
  skills = createSkills(
    { config: new FakeSkillsConfigStore(), runs: store, runner, terminal, urls, notifier, translator: new FakeTranslator() },
    clock,
    connections,
  );
});

function feed(lines: readonly string[]): void {
  for (const line of lines) runner.processes[0]?.stdout(line);
}

describe('RunSkill', () => {
  it('roda claude -p com stream-json, orçamento e ferramentas da config', async () => {
    const { run } = await skills.run.execute('acabativa');
    expect(run.status).toBe('running');
    expect(runner.processes[0]?.spec).toEqual({
      program: 'claude',
      cwd: null,
      args: [
        '-p',
        '/acabativa',
        '--output-format',
        'stream-json',
        '--verbose',
        '--max-budget-usd',
        '2',
        '--allowedTools',
        DEFAULT_ALLOWED_TOOLS.join(','),
      ],
    });
  });

  it('skill com ferramenta fora da lista não abre processo e explica o motivo', async () => {
    const config = new FakeSkillsConfigStore(parseSkillsConfig(null).map((skill) => ({ ...skill, allowedTools: ['Read(./**)', 'Write'] })));
    const guarded = createSkills({ config, runs: store, runner, terminal, urls, notifier, translator: new FakeTranslator() }, clock, connections);
    await expect(guarded.run.execute('acabativa')).rejects.toThrow('usa ferramenta não permitida: Write');
    expect(runner.processes).toHaveLength(0);
    expect(guarded.board.finished()).toHaveLength(0);
  });

  it('mostra o progresso ao vivo e conclui com custo, sessão e resultado', async () => {
    const seen: string[] = [];
    skills.board.subscribe((runs) => seen.push(runs[0]?.status ?? 'vazio'));
    const { run, finished } = await skills.run.execute('acabativa');
    feed(SUCCESS_STREAM.slice(0, 3));
    expect(skills.board.get(run.id)?.log.map((entry) => entry.kind)).toEqual(['text', 'tool']);
    expect(skills.board.get(run.id)?.status).toBe('running');
    feed(SUCCESS_STREAM.slice(3));
    await clock.advance(5_000);
    runner.processes[0]?.exit(0);
    const done = await finished;
    expect(done).toMatchObject({
      status: 'succeeded',
      costUsd: 0.1234,
      sessionId: FIXTURE_SESSION_ID,
      endedAt: 1_005_000,
    });
    expect(done.resultText).toContain('Acabativa');
    expect(seen.at(-1)).toBe('succeeded');
  });

  it('a run segue ocupada entre o result e o exit do processo', async () => {
    const { run, finished } = await skills.run.execute('acabativa');
    feed(SUCCESS_STREAM);
    expect(skills.board.get(run.id)?.status).toBe('succeeded');
    expect(skills.board.isSkillRunning('acabativa')).toBe(true);
    await expect(skills.run.execute('acabativa')).rejects.toThrow('skill-running');
    expect(skills.board.finished()).toHaveLength(0);
    runner.processes[0]?.exit(0);
    await finished;
    expect(skills.board.isSkillRunning('acabativa')).toBe(false);
    expect(skills.board.finished()).toHaveLength(1);
  });

  it('persiste o histórico sem o log', async () => {
    const { finished } = await skills.run.execute('acabativa');
    feed(SUCCESS_STREAM);
    runner.processes[0]?.exit(0);
    await finished;
    expect(store.stored).toHaveLength(1);
    expect(store.stored[0]).toMatchObject({ status: 'succeeded', log: [] });
  });

  it('falha ao salvar o histórico não trava a run', async () => {
    store.failSave = true;
    const { finished } = await skills.run.execute('acabativa');
    feed(SUCCESS_STREAM);
    runner.processes[0]?.exit(0);
    expect((await finished).status).toBe('succeeded');
  });

  it('detecta MCP sem autenticação e deixa o problema na run', async () => {
    const { finished } = await skills.run.execute('acabativa');
    feed(MCP_NEEDS_AUTH_STREAM);
    runner.processes[0]?.exit(1);
    expect(await finished).toMatchObject({
      status: 'failed',
      problem: 'mcp-unauthenticated',
      mcpNeedingAuth: ['atlassian'],
    });
  });

  it('saída sem resultado falha com o stderr', async () => {
    const { finished } = await skills.run.execute('acabativa');
    runner.processes[0]?.stderr('Error: credencial inválida');
    runner.processes[0]?.exit(1);
    expect(await finished).toMatchObject({ status: 'failed', error: 'Error: credencial inválida' });
  });

  it('ignora linhas que não são JSON', async () => {
    const { run } = await skills.run.execute('acabativa');
    feed(NOISY_STREAM);
    expect(skills.board.get(run.id)?.log).toEqual([{ kind: 'text', text: 'ok' }]);
  });

  it('Claude Code ausente vira falha com problema claude-code-missing', async () => {
    runner.startError = new ConnectionProblemError('claude-code-missing', 'claude não encontrado');
    const { run, finished } = await skills.run.execute('acabativa');
    expect(await finished).toMatchObject({ status: 'failed', problem: 'claude-code-missing', error: 'claude não encontrado' });
    expect(skills.board.get(run.id)?.status).toBe('failed');
  });

  it('outro erro ao iniciar vira falha sem problema de conexão', async () => {
    runner.startError = new Error('spawn falhou');
    const { finished } = await skills.run.execute('acabativa');
    expect(await finished).toMatchObject({ status: 'failed', problem: null, error: 'spawn falhou' });
  });

  it('recusa skill desconhecida e execução simultânea da mesma skill', async () => {
    await expect(skills.run.execute('nada')).rejects.toThrow('skill-unknown');
    await skills.run.execute('acabativa');
    await expect(skills.run.execute('acabativa')).rejects.toThrow('skill-running');
    expect(runner.processes).toHaveLength(1);
  });

  it('permite rodar de novo depois de terminar', async () => {
    const first = await skills.run.execute('acabativa');
    feed(SUCCESS_STREAM);
    runner.processes[0]?.exit(0);
    await first.finished;
    const second = await skills.run.execute('acabativa');
    expect(second.run.id).not.toBe(first.run.id);
  });
});

describe('Notificação ao fim da run', () => {
  async function conclude(lines: readonly string[], code: number): Promise<SkillRun> {
    const { finished } = await skills.run.execute('acabativa');
    feed(lines);
    await clock.advance(5_000);
    runner.processes[0]?.exit(code);
    return finished;
  }

  it('sucesso notifica com o custo e a duração', async () => {
    await conclude(SUCCESS_STREAM, 0);
    expect(notifier.sent).toEqual([{ title: 'Acabativa concluída', body: 'US$ 0,12 · 5s' }]);
  });

  it('falha notifica com o motivo', async () => {
    const { finished } = await skills.run.execute('acabativa');
    runner.processes[0]?.stderr('Error: credencial inválida');
    runner.processes[0]?.exit(1);
    await finished;
    expect(notifier.sent).toEqual([{ title: 'Acabativa falhou', body: 'Error: credencial inválida · 0s' }]);
  });

  it('cancelada não notifica', async () => {
    const { run, finished } = await skills.run.execute('acabativa');
    await skills.cancel.execute(run.id);
    await finished;
    expect(notifier.sent).toEqual([]);
  });

  it('com a conexão de notificações bloqueada não notifica', async () => {
    world.notifications.state = 'denied';
    await connections.check.execute('notifications');
    await conclude(SUCCESS_STREAM, 0);
    expect(notifier.sent).toEqual([]);
  });

  it('com o estado ainda desconhecido verifica a conexão antes de notificar', async () => {
    const fresh = createConnections(world.adapters, clock);
    const lazy = createSkills(
      { config: new FakeSkillsConfigStore(), runs: store, runner, terminal, urls, notifier, translator: new FakeTranslator() },
      clock,
      fresh,
    );
    const { finished } = await lazy.run.execute('acabativa');
    feed(SUCCESS_STREAM);
    runner.processes[0]?.exit(0);
    await finished;
    expect(notifier.sent).toHaveLength(1);
  });

  it('falha ao notificar não trava a run', async () => {
    notifier.fail = true;
    expect((await conclude(SUCCESS_STREAM, 0)).status).toBe('succeeded');
  });
});

describe('CancelSkillRun', () => {
  it('mata o processo e marca a run como cancelada', async () => {
    const { run, finished } = await skills.run.execute('acabativa');
    await skills.cancel.execute(run.id);
    expect(runner.processes[0]?.killed).toBe(1);
    expect(await finished).toMatchObject({ status: 'cancelled', error: null });
  });

  it('cancelar antes do processo estar anexado fica guardado e mata no attach', async () => {
    let release: () => void = () => undefined;
    runner.startGate = new Promise<void>((resolve) => (release = resolve));
    const starting = skills.run.execute('acabativa');
    await Promise.resolve();
    const runId = skills.board.list()[0]?.id ?? '';
    await skills.cancel.execute(runId);
    expect(runner.processes[0]?.killed).toBe(0);
    release();
    const { finished } = await starting;
    expect(runner.processes[0]?.killed).toBe(1);
    expect(await finished).toMatchObject({ status: 'cancelled', error: null });
  });

  it('cancelar uma run que já terminou não faz nada', async () => {
    const { run, finished } = await skills.run.execute('acabativa');
    runner.processes[0]?.exit(1);
    await finished;
    await skills.cancel.execute(run.id);
    expect(runner.processes[0]?.killed).toBe(0);
  });
});

describe('histórico', () => {
  it('carrega as runs gravadas para o quadro', async () => {
    const old: SkillRun = {
      id: 'old',
      skillId: 'acabativa',
      name: 'Acabativa',
      prompt: '/acabativa',
      status: 'succeeded',
      startedAt: 10,
      endedAt: 20,
      costUsd: 0.5,
      sessionId: FIXTURE_SESSION_ID,
      cwd: null,
      resultText: 'ok',
      error: null,
      failure: null,
      exitCode: null,
      problem: null,
      mcpNeedingAuth: [],
      log: [],
    };
    store.stored = [old];
    await skills.loadRuns.execute();
    expect(skills.board.list()).toEqual([old]);
  });
});

describe('Continuar no terminal', () => {
  it('abre o terminal com claude --resume <session_id>', async () => {
    const { run, finished } = await skills.run.execute('acabativa');
    feed(SUCCESS_STREAM);
    runner.processes[0]?.exit(0);
    await finished;
    await skills.continueInTerminal.execute(run.id);
    expect(terminal.commands).toEqual([{ program: 'claude', args: ['--resume', FIXTURE_SESSION_ID], cwd: null }]);
  });

  it('retoma na mesma pasta em que a run foi iniciada', async () => {
    const config = new FakeSkillsConfigStore(
      parseSkillsConfig({ skills: [{ id: 'proj', name: 'Proj', prompt: '/proj', cwd: '/Users/dev/proj' }] }),
    );
    const scoped = createSkills({ config, runs: store, runner, terminal, urls, notifier, translator: new FakeTranslator() }, clock, connections);
    const { run, finished } = await scoped.run.execute('proj');
    expect(runner.processes[0]?.spec.cwd).toBe('/Users/dev/proj');
    feed(SUCCESS_STREAM);
    runner.processes[0]?.exit(0);
    await finished;
    await scoped.continueInTerminal.execute(run.id);
    expect(terminal.commands).toEqual([
      { program: 'claude', args: ['--resume', FIXTURE_SESSION_ID], cwd: '/Users/dev/proj' },
    ]);
  });

  it('sem session_id válido recusa', async () => {
    const { run } = await skills.run.execute('acabativa');
    await expect(skills.continueInTerminal.execute(run.id)).rejects.toThrow('skill-no-session');
    await expect(skills.continueInTerminal.execute('inexistente')).rejects.toThrow('skill-no-session');
    expect(terminal.commands).toHaveLength(0);
  });
});

describe('FixSkillProblem', () => {
  it('Reconectar MCP abre o terminal com claude /mcp', async () => {
    await skills.fix.execute('reconnect-mcp');
    expect(terminal.commands).toEqual([{ program: 'claude', args: ['/mcp'], cwd: null }]);
  });

  it('Reconectar MCP usa o cwd da run', async () => {
    const { run } = await skills.run.execute('acabativa');
    await skills.fix.execute('reconnect-mcp', run.id);
    expect(terminal.commands).toEqual([{ program: 'claude', args: ['/mcp'], cwd: run.cwd }]);
  });

  it('Instalar abre a página de instalação do Claude Code', async () => {
    await skills.fix.execute('install-claude-code');
    expect(urls.opened).toEqual([CLAUDE_CODE_INSTALL_URL]);
  });
});

describe('configuração', () => {
  it('ListSkills devolve as skills configuradas', async () => {
    expect((await skills.list.execute()).map((skill) => skill.id)).toEqual(parseSkillsConfig(null).map((skill) => skill.id));
  });
});
