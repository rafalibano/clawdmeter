import { connectionDefinition, type ConnectionId } from './connection';
import type { ConnectionProblem } from './connection-problem';
import { statusForProblem, type ConnectionStatus } from './connection-status';
import { FIX_FOR, FIX_LABELS, type FixAction } from './fix-action';

export type ConnectionAction =
  | { kind: 'connect'; label: string }
  | { kind: 'fix'; fix: FixAction; label: string }
  | { kind: 'recheck'; label: string }
  | { kind: 'disconnect'; label: string };

const CONNECT: ConnectionAction = { kind: 'connect', label: 'Conectar' };
const RECHECK: ConnectionAction = { kind: 'recheck', label: 'Verificar de novo' };
const DISCONNECT: ConnectionAction = { kind: 'disconnect', label: 'Desconectar' };

export function actionsFor(id: ConnectionId, status: ConnectionStatus): ConnectionAction[] {
  const disconnectable = connectionDefinition(id).disconnectable;
  switch (status.state) {
    case 'unknown':
    case 'checking':
      return [];
    case 'disconnected':
      return [CONNECT];
    case 'connected':
      return disconnectable ? [DISCONNECT] : [];
    case 'error': {
      const fix = FIX_FOR[status.problem];
      const actions: ConnectionAction[] = [{ kind: 'fix', fix, label: FIX_LABELS[fix] }];
      if (fix !== 'retry') actions.push(RECHECK);
      if (disconnectable) actions.push(DISCONNECT);
      return actions;
    }
  }
}

export function actionsForProblem(id: ConnectionId, problem: ConnectionProblem): ConnectionAction[] {
  return actionsFor(id, statusForProblem(problem)).filter((action) => action.kind !== 'disconnect');
}
