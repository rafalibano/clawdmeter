export interface McpServerStatus {
  name: string;
  status: string;
}

export type StreamBlock = { kind: 'text'; text: string } | { kind: 'tool'; name: string };

export type StreamEvent =
  | { type: 'init'; sessionId: string | null; mcpServers: McpServerStatus[] }
  | { type: 'assistant'; sessionId: string | null; blocks: StreamBlock[] }
  | {
      type: 'result';
      sessionId: string | null;
      isError: boolean;
      subtype: string | null;
      text: string | null;
      costUsd: number | null;
      durationMs: number | null;
    }
  | { type: 'truncated' }
  | { type: 'other' };

export const LINE_TRUNCATED_MARK = '…[line truncated]';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function parseMcpServers(value: unknown): McpServerStatus[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isObject(entry)) return [];
    const name = asString(entry['name']);
    const status = asString(entry['status']);
    return name !== null && status !== null ? [{ name, status }] : [];
  });
}

function parseBlocks(message: unknown): StreamBlock[] {
  const content = isObject(message) ? message['content'] : null;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): StreamBlock[] => {
    if (!isObject(block)) return [];
    if (block['type'] === 'text') {
      const text = asString(block['text']);
      return text !== null && text.trim() !== '' ? [{ kind: 'text', text }] : [];
    }
    if (block['type'] === 'tool_use') {
      const name = asString(block['name']);
      return name !== null ? [{ kind: 'tool', name }] : [];
    }
    return [];
  });
}

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  if (trimmed.endsWith(LINE_TRUNCATED_MARK)) return { type: 'truncated' };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const sessionId = asString(raw['session_id']);
  switch (raw['type']) {
    case 'system':
      return raw['subtype'] === 'init'
        ? { type: 'init', sessionId, mcpServers: parseMcpServers(raw['mcp_servers']) }
        : { type: 'other' };
    case 'assistant':
      return { type: 'assistant', sessionId, blocks: parseBlocks(raw['message']) };
    case 'result':
      return {
        type: 'result',
        sessionId,
        isError: raw['is_error'] === true || (asString(raw['subtype']) ?? 'success') !== 'success',
        subtype: asString(raw['subtype']),
        text: asString(raw['result']),
        costUsd: asNumber(raw['total_cost_usd']),
        durationMs: asNumber(raw['duration_ms']),
      };
    default:
      return { type: 'other' };
  }
}
