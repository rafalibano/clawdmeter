export interface StreamingProcessSpec {
  program: 'claude' | 'gh';
  args: string[];
  cwd: string | null;
}

export interface StreamingProcessHandlers {
  onLine(line: string, stream: 'stdout' | 'stderr'): void;
  onExit(code: number | null): void;
}

export interface StreamingProcessHandle {
  kill(): Promise<void>;
}

export interface StreamingProcessRunner {
  start(spec: StreamingProcessSpec, handlers: StreamingProcessHandlers): Promise<StreamingProcessHandle>;
}
