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
  it('calls process_spawn and delivers only the events of the returned spawn id', async () => {
    const bus = createBus();
    const { commands, calls } = createFakeCommands(() => 4242);
    const lines: string[] = [];
    const exits: Array<number | null> = [];
    const runner = new TauriStreamingProcessRunner(commands, bus.listen);
    await runner.start({ ...SPEC, args: [...SPEC.args] }, { onLine: (line) => lines.push(line), onExit: (code) => exits.push(code) });
    expect(calls[0]).toEqual({ command: 'process_spawn', args: { program: 'claude', args: ['-p', '/acabativa'], cwd: null } });
    bus.emit('process-output', { id: 4242, stream: 'stdout', line: 'a' });
    bus.emit('process-output', { id: 1, stream: 'stdout', line: 'de outro processo' });
    bus.emit('process-exit', { id: 1, code: 9 });
    bus.emit('process-output', { id: 4242, stream: 'stderr', line: 'b' });
    bus.emit('process-exit', { id: 4242, code: 0 });
    expect(lines).toEqual(['a', 'b']);
    expect(exits).toEqual([0]);
    expect(bus.listeners()).toBe(0);
  });

  it('redelivers events that arrive before the spawn id is known', async () => {
    const bus = createBus();
    const lines: string[] = [];
    const exits: Array<number | null> = [];
    const { commands } = createFakeCommands(() => {
      bus.emit('process-output', { id: 7, stream: 'stdout', line: 'cedo' });
      bus.emit('process-output', { id: 8, stream: 'stdout', line: 'outro' });
      bus.emit('process-exit', { id: 7, code: 1 });
      return 7;
    });
    await new TauriStreamingProcessRunner(commands, bus.listen).start(
      { ...SPEC, args: [] },
      { onLine: (line) => lines.push(line), onExit: (code) => exits.push(code) },
    );
    expect(lines).toEqual(['cedo']);
    expect(exits).toEqual([1]);
  });

  it('kill calls process_kill with the spawn id', async () => {
    const bus = createBus();
    const { commands, calls } = createFakeCommands(() => 55);
    const handle = await new TauriStreamingProcessRunner(commands, bus.listen).start(
      { ...SPEC, args: [] },
      { onLine: () => undefined, onExit: () => undefined },
    );
    await handle.kill();
    expect(calls.at(-1)).toEqual({ command: 'process_kill', args: { id: 55 } });
  });

  it('ignores events that only carry a pid, even if it matches the spawn id', async () => {
    const bus = createBus();
    const { commands } = createFakeCommands(() => 9);
    const lines: string[] = [];
    await new TauriStreamingProcessRunner(commands, bus.listen).start(
      { ...SPEC, args: [] },
      { onLine: (line) => lines.push(line), onExit: () => undefined },
    );
    bus.emit('process-output', { pid: 9, stream: 'stdout', line: 'old run' });
    bus.emit('process-output', { id: 9, stream: 'stdout', line: 'this run' });
    expect(lines).toEqual(['this run']);
  });

  it('missing claude becomes claude-code-missing and releases the listeners', async () => {
    const bus = createBus();
    const { commands } = createFakeCommands(() => rejectWith('program_not_found', 'claude not found'));
    await expect(
      new TauriStreamingProcessRunner(commands, bus.listen).start(
        { ...SPEC, args: [] },
        { onLine: () => undefined, onExit: () => undefined },
      ),
    ).rejects.toMatchObject({ problem: 'claude-code-missing', message: 'claude not found' });
    expect(bus.listeners()).toBe(0);
  });

  it('other spawn errors pass through', async () => {
    const bus = createBus();
    const { commands } = createFakeCommands(() => rejectWith('spawn_failed', 'permission denied'));
    await expect(
      new TauriStreamingProcessRunner(commands, bus.listen).start(
        { program: 'gh', args: [], cwd: null },
        { onLine: () => undefined, onExit: () => undefined },
      ),
    ).rejects.toMatchObject({ kind: 'spawn_failed' });
  });
});
