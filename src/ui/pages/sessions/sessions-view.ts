import type { SessionsData } from '../../../application/use-cases';
import {
  sessionAttention,
  sessionTitle,
  shortCwd,
  statusSince,
  type ClaudeSession,
  type SessionAttention,
  type SessionStatus,
} from '../../../domain/sessions';
import { formatSince, formatSpan } from '../../format/time';

export interface SessionRowView {
  key: string;
  title: string;
  cwd: string;
  status: SessionStatus | 'unknown';
  statusLabel: string;
  since: string;
  attention: SessionAttention | null;
  attentionLabel: string | null;
}

export interface SessionsView {
  rows: SessionRowView[];
  summary: string;
}

const STATUS_LABELS: Record<SessionStatus | 'unknown', string> = {
  busy: 'Trabalhando',
  idle: 'Ociosa',
  shell: 'Shell',
  unknown: 'Desconhecido',
};

function attentionLabel(attention: SessionAttention | null, elapsedMs: number): string | null {
  switch (attention) {
    case 'waiting-input':
      return `Aguardando input há ${formatSpan(elapsedMs)}`;
    case 'running-long':
      return `Ocupada há ${formatSpan(elapsedMs)}`;
    case null:
      return null;
  }
}

function toRow(session: ClaudeSession, data: SessionsData): SessionRowView {
  const since = statusSince(session);
  const elapsed = since === null ? 0 : Math.max(0, data.at - since);
  const attention = sessionAttention(session, data.at, data.attention);
  const status = session.status ?? 'unknown';
  return {
    key: String(session.pid),
    title: sessionTitle(session),
    cwd: shortCwd(session.cwd),
    status,
    statusLabel: STATUS_LABELS[status],
    since: since === null ? '—' : formatSince(elapsed),
    attention,
    attentionLabel: attentionLabel(attention, elapsed),
  };
}

function summarize(rows: readonly SessionRowView[]): string {
  if (rows.length === 0) return 'Nenhuma sessão do Claude Code aberta.';
  const noun = rows.length === 1 ? 'sessão' : 'sessões';
  const flagged = rows.filter((row) => row.attention !== null).length;
  if (flagged === 0) return `${rows.length} ${noun}`;
  return `${rows.length} ${noun} · ${flagged} ${flagged === 1 ? 'pede' : 'pedem'} atenção`;
}

export function toSessionsView(data: SessionsData): SessionsView {
  const rows = data.sessions.map((session) => toRow(session, data));
  return { rows, summary: summarize(rows) };
}
