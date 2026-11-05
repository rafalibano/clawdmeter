import type { FetchLike } from '../platform/tauri-fetch';
import { TauriCommands, type Invoke } from '../platform/tauri-commands';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal?: AbortSignal;
}

export interface FakeResponse {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
}

export type Responder = (request: RecordedRequest) => FakeResponse | undefined;

export function createFakeFetch(responder: Responder): { fetcher: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetcher: FetchLike = async (url, init) => {
    const request: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
      ...(init?.signal ? { signal: init.signal } : {}),
    };
    requests.push(request);
    const reply = responder(request);
    if (!reply) throw new Error(`Requisição sem resposta gravada: ${request.method} ${url}`);
    return new Response(JSON.stringify(reply.json ?? {}), {
      status: reply.status ?? 200,
      headers: reply.headers ?? {},
    });
  };
  return { fetcher, requests };
}

export interface RecordedCall {
  command: string;
  args: Record<string, unknown> | undefined;
}

export function createFakeCommands(
  handler: (command: string, args: Record<string, unknown> | undefined) => unknown,
): { commands: TauriCommands; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const invoke: Invoke = async <T>(command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    const result = handler(command, args);
    if (result instanceof RejectedCommand) throw result.error;
    return result as T;
  };
  return { commands: new TauriCommands(invoke), calls };
}

export class RejectedCommand {
  constructor(readonly error: unknown) {}
}

export function rejectWith(kind: string, message: string, extra: Record<string, unknown> = {}): RejectedCommand {
  return new RejectedCommand({ kind, message, ...extra });
}
