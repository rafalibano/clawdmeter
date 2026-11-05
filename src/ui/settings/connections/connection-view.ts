import {
  PROBLEM_MESSAGES,
  actionsFor,
  connectionDefinition,
  type ConnectionAction,
  type ConnectionId,
  type ConnectionStatus,
} from '../../../domain/connections';

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

function describe(status: ConnectionStatus): { tone: ConnectionTone; summary: string; message: string | null } {
  switch (status.state) {
    case 'unknown':
      return { tone: 'idle', summary: 'Não verificada', message: null };
    case 'checking':
      return { tone: 'busy', summary: 'Verificando…', message: null };
    case 'disconnected':
      return { tone: 'idle', summary: 'Desconectado', message: status.hint ?? null };
    case 'connected':
      return {
        tone: 'ok',
        summary: status.account ? `Conectado · ${status.account}` : 'Conectado',
        message: status.detail ?? null,
      };
    case 'error':
      return {
        tone: 'error',
        summary: status.problem === 'notifications-unverifiable' ? 'Não verificável' : 'Atenção',
        message: status.message ?? PROBLEM_MESSAGES[status.problem],
      };
  }
}

export function toRowView(id: ConnectionId, status: ConnectionStatus): ConnectionRowView {
  return {
    id,
    label: connectionDefinition(id).label,
    ...describe(status),
    actions: actionsFor(id, status),
    signInOptions: id === 'github' && (status.state === 'disconnected' || status.state === 'unknown'),
    busy: status.state === 'checking',
  };
}
