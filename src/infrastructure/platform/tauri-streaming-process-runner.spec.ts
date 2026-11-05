import { describe, expect, it } from 'vitest';
import { createFakeCommands, rejectWith } from '../testing/fakes';
import { TauriStreamingProcessRunner, type Listen } from './tauri-streaming-process-runner';

function createBus() {
  const handlers = new Map<string, Set<(event: { payload: unknown }) => void>>();
  const listen: Listen = async (event, handler) => {
    const set = handlers.get(event) ?? new Set();
    set.add(handler as (event: { payload: unknown }) => void);
    handlers.set(event, set);
    return () => set.delete(handler as (event: { payload: unknown }) => void);
  };
  const emit = (event: string, payload: unknown) => {
    for (const handler of handlers.get(event) ?? []) handler({ payload });
  };
  const listeners = () => [...handlers.values()].reduce((total, set) => total + set.size, 0);
  return { listen, emit, listeners };
}

const SPEC = { program: 'claude', args: ['-p', '/acabativa'], cwd: null } as const;

describe('TauriStreamingProcessRunner', () => {
  it('chama process_spawn e entrega só os eventos do pid devolvido', async () => {
    const bus = createBus();
    const { commands, calls } = createFakeCommands(() => 4242);
    const lines: string[] = [];
    const exits: Array<number | null> = [];
    const runner = new TauriStreamingProcessRunner(commands, bus.listen);
    await runner.start({ ...SPEC, args: [...SPEC.args] }, { onLine: (line) => lines.push(line), onExit: (code) => exits.push(code) });
    expect(calls[0]).toEqual({ command: 'process_spawn', args: { program: 'claude', args: ['-p', '/acabativa'], cwd: null } });
    bus.emit('process-output', { pid: 4242, stream: 'stdout', line: 'a' });
    bus.emit('process-output', { pid: 1, stream: 'stdout', line: 'de outro processo' });
    bus.emit('process-exit', { pid: 1, code: 9 });
    bus.emit('process-output', { pid: 4242, stream: 'stderr', line: 'b' });
    bus.emit('process-exit', { pid: 4242, code: 0 });
    expect(lines).toEqual(['a', 'b']);
    expect(exits).toEqual([0]);
    expect(bus.listeners()).toBe(0);
  });

  it('reentrega eventos que chegam antes de o pid ser conhecido', async () => {
    const bus = createBus();
    const lines: string[] = [];
    const exits: Array<number | null> = [];
    const { commands } = createFakeCommands(() => {
      bus.emit('process-output', { pid: 7, stream: 'stdout', line: 'cedo' });
      bus.emit('process-output', { pid: 8, stream: 'stdout', line: 'outro' });
      bus.emit('process-exit', { pid: 7, code: 1 });
      return 7;
    });
    await new TauriStreamingProcessRunner(commands, bus.listen).start(
      { ...SPEC, args: [] },
      { onLine: (line) => lines.push(line), onExit: (code) => exits.push(code) },
    );
    expect(lines).toEqual(['cedo']);
    expect(exits).toEqual([1]);
  });

  it('kill chama process_kill com o pid', async () => {
    const bus = createBus();
    const { commands, calls } = createFakeCommands(() => 55);
    const handle = await new TauriStreamingProcessRunner(commands, bus.listen).start(
      { ...SPEC, args: [] },
      { onLine: () => undefined, onExit: () => undefined },
    );
    await handle.kill();
    expect(calls.at(-1)).toEqual({ command: 'process_kill', args: { pid: 55 } });
  });

  it('claude ausente vira claude-code-missing e solta os listeners', async () => {
    const bus = createBus();
    const { commands } = createFakeCommands(() => rejectWith('program_not_found', 'claude não encontrado'));
    await expect(
      new TauriStreamingProcessRunner(commands, bus.listen).start(
        { ...SPEC, args: [] },
        { onLine: () => undefined, onExit: () => undefined },
      ),
    ).rejects.toMatchObject({ problem: 'claude-code-missing', message: 'claude não encontrado' });
    expect(bus.listeners()).toBe(0);
  });

  it('outros erros do spawn passam adiante', async () => {
    const bus = createBus();
    const { commands } = createFakeCommands(() => rejectWith('spawn_failed', 'sem permissão'));
    await expect(
      new TauriStreamingProcessRunner(commands, bus.listen).start(
        { program: 'gh', args: [], cwd: null },
        { onLine: () => undefined, onExit: () => undefined },
      ),
    ).rejects.toMatchObject({ kind: 'spawn_failed' });
  });
});
