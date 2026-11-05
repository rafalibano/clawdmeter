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

function toRow(session: ClaudeSession, data: SessionsData, l: Localizer): SessionRowView {
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
