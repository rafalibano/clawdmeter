export interface SubagentUsage {
  id: string;
  agentType: string | null;
  model: string | null;
  startedAt: number | null;
}

export interface SessionUsage {
  model: string | null;
  contextTokens: number | null;
  longContext: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  subagents: SubagentUsage[];
}

const ONE_MILLION = 1_000_000;
const TWO_HUNDRED_K = 200_000;

const CONTEXT_WINDOWS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^claude-(fable|mythos)-5/, ONE_MILLION],
  [/^claude-opus-(5|4-[678])/, ONE_MILLION],
  [/^claude-sonnet-(5|4-6)/, ONE_MILLION],
  [/^claude-haiku-5/, ONE_MILLION],
  [/^claude-(opus|sonnet|haiku)-4/, TWO_HUNDRED_K],
  [/^claude-3/, TWO_HUNDRED_K],
];

export function contextWindow(model: string | null, longContext: boolean): number | null {
  if (longContext) return ONE_MILLION;
  if (model === null) return null;
  return CONTEXT_WINDOWS.find(([pattern]) => pattern.test(model))?.[1] ?? null;
}

export function contextShare(usage: SessionUsage): number | null {
  const window = contextWindow(usage.model, usage.longContext);
  if (window === null || usage.contextTokens === null) return null;
  return Math.min(1, usage.contextTokens / window);
}

export function shortModel(model: string | null): string | null {
  if (model === null) return null;
  return model.replace(/^claude-/, '');
}
