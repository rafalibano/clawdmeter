import { listen } from '@tauri-apps/api/event';
import type {
  StreamingProcessHandle,
  StreamingProcessHandlers,
  StreamingProcessRunner,
  StreamingProcessSpec,
} from '../../application/ports';
import { ConnectionProblemError } from '../../domain/connections';
import { RunProblemError } from '../../domain/skills';
import { PlatformCommandError, type TauriCommands } from './tauri-commands';

export type Listen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

interface OutputPayload {
  id: number;
  stream: 'stdout' | 'stderr';
  line: string;
}

interface ExitPayload {
  id: number;
  code: number | null;
}

type Buffered = { kind: 'line'; payload: OutputPayload } | { kind: 'exit'; payload: ExitPayload };

export class TauriStreamingProcessRunner implements StreamingProcessRunner {
  constructor(
    private readonly commands: TauriCommands,
    private readonly subscribe: Listen = listen,
  ) {}

  async start(spec: StreamingProcessSpec, handlers: StreamingProcessHandlers): Promise<StreamingProcessHandle> {
    let id: number | null = null;
    let stopped = false;
    const buffered: Buffered[] = [];
    const unlisteners: Array<() => void> = [];

    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      for (const unlisten of unlisteners) unlisten();
    };
    const deliver = (item: Buffered): void => {
      if (item.payload.id !== id) return;
      if (item.kind === 'line') {
        handlers.onLine(item.payload.line, item.payload.stream);
        return;
      }
      stop();
      handlers.onExit(item.payload.code);
    };
    const receive = (item: Buffered): void => {
      if (id === null) buffered.push(item);
      else deliver(item);
    };

    unlisteners.push(
      await this.subscribe<OutputPayload>('process-output', (event) => receive({ kind: 'line', payload: event.payload })),
      await this.subscribe<ExitPayload>('process-exit', (event) => receive({ kind: 'exit', payload: event.payload })),
    );

    try {
      id = await this.commands.call<number>('process_spawn', { program: spec.program, args: spec.args, cwd: spec.cwd });
    } catch (error) {
      stop();
      throw mapSpawnError(error, spec.program);
    }

    const spawned = id;
    for (const item of buffered.splice(0)) deliver(item);
    return { kill: () => this.commands.call<void>('process_kill', { id: spawned }) };
  }
}

function mapSpawnError(error: unknown, program: string): unknown {
  if (error instanceof PlatformCommandError && error.kind === 'program_not_found') {
    return program === 'claude'
      ? new RunProblemError('claude-code-missing', error.message)
      : new ConnectionProblemError('unexpected', error.message);
  }
  return error;
}
