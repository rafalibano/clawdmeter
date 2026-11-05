import { beforeEach, describe, expect, it } from 'vitest';
import { CLAUDE_CODE_INSTALL_URL, ConnectionProblemError } from '../../../domain/connections';
import {
  FIXTURE_SESSION_ID,
  MCP_NEEDS_AUTH_STREAM,
  NOISY_STREAM,
  SUCCESS_STREAM,
  parseSkillsConfig,
  type SkillRun,
} from '../../../domain/skills';
import { createSkills, type Skills } from '../../skills';
import { FakeClock } from '../../testing/fake-clock';
import { FakeTerminal, FakeUrlOpener } from '../../testing/fake-connection-adapters';
import {
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

beforeEach(async () => {
  runner = new FakeStreamingProcessRunner();
  store = new FakeSkillRunStore();
  terminal = new FakeTerminal();
  urls = new FakeUrlOpener();
  clock = new FakeClock();
  await clock.advance(1_000_000);
  skills = createSkills(
    { config: new FakeSkillsConfigStore(), runs: store, runner, terminal, urls },
    clock,
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
        'Read,Grep,Glob,Bash(gh:*),Bash(git:*)',
      ],
    });
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
    await expect(skills.run.execute('nada')).rejects.toThrow('Skill desconhecida: nada');
    await skills.run.execute('acabativa');
    await expect(skills.run.execute('acabativa')).rejects.toThrow('já está rodando');
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

describe('CancelSkillRun', () => {
  it('mata o processo e marca a run como cancelada', async () => {
    const { run, finished } = await skills.run.execute('acabativa');
    await skills.cancel.execute(run.id);
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
      resultText: 'ok',
      error: null,
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
    expect(terminal.commands).toEqual([{ program: 'claude', args: ['--resume', FIXTURE_SESSION_ID] }]);
  });

  it('sem session_id válido recusa', async () => {
    const { run } = await skills.run.execute('acabativa');
    await expect(skills.continueInTerminal.execute(run.id)).rejects.toThrow('sessão');
    await expect(skills.continueInTerminal.execute('inexistente')).rejects.toThrow('sessão');
    expect(terminal.commands).toHaveLength(0);
  });
});

describe('FixSkillProblem', () => {
  it('Reconectar MCP abre o terminal com claude /mcp', async () => {
    await skills.fix.execute('reconnect-mcp');
    expect(terminal.commands).toEqual([{ program: 'claude', args: ['/mcp'] }]);
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
