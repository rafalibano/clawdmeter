import {
  GITHUB_ORG,
  actionsFor,
  type ConnectionAction,
  type ConnectionId,
  type ConnectionStatus,
  type StatusNote,
} from '../../../domain/connections';
import type { Localizer } from '../../i18n';

export type ConnectionTone = 'ok' | 'error' | 'idle' | 'busy';

export interface ConnectionRowView {
  id: ConnectionId;
  label: string;
  tone: ConnectionTone;
  summary: string;
  message: string | null;
  actions: ConnectionAction[];
  signInOptions: boolean;
  busy: boolean;
}

function noteText(l: Localizer, note: StatusNote, arg: string | undefined): string {
  return l.t(`note.${note}`, { org: GITHUB_ORG, scopes: arg ?? '' });
}

function describe(status: ConnectionStatus, l: Localizer): { tone: ConnectionTone; summary: string; message: string | null } {
  switch (status.state) {
    case 'unknown':
      return { tone: 'idle', summary: l.t('connection.status.unknown'), message: null };
    case 'checking':
      return { tone: 'busy', summary: l.t('connection.status.checking'), message: null };
    case 'disconnected':
      return {
        tone: 'idle',
        summary: l.t('connection.status.disconnected'),
        message: status.note === undefined ? null : noteText(l, status.note, undefined),
      };
    case 'connected':
      return {
        tone: 'ok',
        summary: status.account
          ? l.t('connection.status.connectedAs', { account: status.account })
          : l.t('connection.status.connected'),
        message: status.detail ?? null,
      };
    case 'error':
      return {
        tone: 'error',
        summary:
          status.problem === 'notifications-unverifiable'
            ? l.t('connection.status.unverifiable')
            : l.t('connection.status.attention'),
        message:
          status.note !== undefined
            ? noteText(l, status.note, status.noteArg)
            : status.code !== undefined
              ? l.t(`error.${status.code}`, status.args)
              : (status.message ?? l.t(`problem.${status.problem}`, { org: GITHUB_ORG })),
      };
  }
}

export function toRowView(id: ConnectionId, status: ConnectionStatus, l: Localizer): ConnectionRowView {
  return {
    id,
    label: l.t(`connection.${id}`),
    ...describe(status, l),
    actions: actionsFor(id, status),
    signInOptions: id === 'github' && (status.state === 'disconnected' || status.state === 'unknown'),
    busy: status.state === 'checking',
  };
}
