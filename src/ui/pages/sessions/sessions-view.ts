import type { SessionsData } from '../../../application/use-cases';
import {
  contextShare,
  contextWindow,
  sessionAttention,
  shortModel,
  sessionTitle,
  shortCwd,
  statusSince,
  type ClaudeSession,
  type SessionAttention,
  type SessionStatus,
  type SessionUsage,
} from '../../../domain/sessions';
import type { Localizer } from '../../i18n';

export interface SessionRowView {
  key: string;
  title: string;
  cwd: string;
  status: SessionStatus | 'unknown';
  statusLabel: string;
  since: string;
  attention: SessionAttention | null;
  attentionLabel: string | null;
  model: string | null;
  context: string | null;
  contextLevel: ContextLevel | null;
  details: SessionDetailsView | null;
}

export type ContextLevel = 'ok' | 'warning' | 'critical';

export interface TokenCountView {
  label: string;
  value: string;
}

export interface SubagentRowView {
  key: string;
  type: string;
  model: string;
  alive: string;
}

export interface SessionDetailsView {
  tokens: TokenCountView[];
  subagents: SubagentRowView[];
}

export interface SessionsView {
  rows: SessionRowView[];
  summary: string;
}

function attentionLabel(attention: SessionAttention | null, elapsedMs: number, l: Localizer): string | null {
  switch (attention) {
    case 'waiting-input':
      return l.t('session.attention.waiting', { span: l.span(elapsedMs) });
    case 'running-long':
      return l.t('session.attention.long', { span: l.span(elapsedMs) });
    case null:
      return null;
  }
}

const CONTEXT_WARNING = 0.7;
const CONTEXT_CRITICAL = 0.9;

export function compactTokens(count: number, l: Localizer): string {
  if (count >= 999_500) return `${l.number(count / 1_000_000, 1)}M`;
  if (count >= 1_000) return `${l.number(count / 1_000, 0)}k`;
  return l.number(count, 0);
}

function contextLabel(usage: SessionUsage, l: Localizer): string | null {
  if (usage.contextTokens === null) return null;
  const used = compactTokens(usage.contextTokens, l);
  const window = contextWindow(usage.model, usage.longContext);
  const share = contextShare(usage);
  if (window === null || share === null) return l.t('session.context.unknown', { used });
  return l.t('session.context', { used, window: compactTokens(window, l), percent: Math.round(share * 100) });
}

function contextLevel(usage: SessionUsage): ContextLevel | null {
  const share = contextShare(usage);
  if (share === null) return null;
  if (share >= CONTEXT_CRITICAL) return 'critical';
  return share >= CONTEXT_WARNING ? 'warning' : 'ok';
}

function toDetails(usage: SessionUsage, at: number, l: Localizer): SessionDetailsView {
  const unknown = l.t('session.subagent.unknown');
  return {
    tokens: [
      { label: l.t('session.tokens.input'), value: compactTokens(usage.inputTokens, l) },
      { label: l.t('session.tokens.output'), value: compactTokens(usage.outputTokens, l) },
      { label: l.t('session.tokens.cacheRead'), value: compactTokens(usage.cacheReadTokens, l) },
      { label: l.t('session.tokens.cacheWrite'), value: compactTokens(usage.cacheCreationTokens, l) },
    ],
    subagents: usage.subagents.map((subagent) => ({
      key: subagent.id,
      type: subagent.agentType ?? unknown,
      model: shortModel(subagent.model) ?? unknown,
      alive: subagent.startedAt === null ? '—' : l.span(Math.max(0, at - subagent.startedAt)),
    })),
  };
}

function toRow(session: ClaudeSession, data: SessionsData, l: Localizer): SessionRowView {
  const usage = data.usage.get(session.pid) ?? null;
  const since = statusSince(session);
  const elapsed = since === null ? 0 : Math.max(0, data.at - since);
  const attention = sessionAttention(session, data.at, data.attention);
  const status = session.status ?? 'unknown';
  return {
    key: String(session.pid),
    title: sessionTitle(session),
    cwd: shortCwd(session.cwd),
    status,
    statusLabel: l.t(`session.status.${status}`),
    since: since === null ? '—' : l.since(elapsed),
    attention,
    attentionLabel: attentionLabel(attention, elapsed, l),
    model: usage === null ? null : shortModel(usage.model),
    context: usage === null ? null : contextLabel(usage, l),
    contextLevel: usage === null ? null : contextLevel(usage),
    details: usage === null ? null : toDetails(usage, data.at, l),
  };
}

function summarize(rows: readonly SessionRowView[], l: Localizer): string {
  if (rows.length === 0) return l.t('sessions.empty');
  const flagged = rows.filter((row) => row.attention !== null).length;
  const total = l.count('sessions.count', rows.length);
  return flagged === 0 ? total : `${total} · ${l.count('sessions.flagged', flagged)}`;
}

export function toSessionsView(data: SessionsData, l: Localizer): SessionsView {
  const rows = data.sessions.map((session) => toRow(session, data, l));
  return { rows, summary: summarize(rows, l) };
}
