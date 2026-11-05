import { connectionDefinition, type ConnectionId } from './connection';
import type { ConnectionProblem } from './connection-problem';
import { statusForProblem, type ConnectionStatus } from './connection-status';
import type { GitHubCliStep } from './github';
import { FIX_FOR, type FixAction } from './fix-action';

export type ActionLabel = 'connect' | 'recheck' | 'disconnect' | FixAction;

export type ConnectionAction =
  | { kind: 'connect'; label: ActionLabel }
  | { kind: 'fix'; fix: FixAction; label: ActionLabel }
  | { kind: 'recheck'; label: ActionLabel }
  | { kind: 'disconnect'; label: ActionLabel };

const CONNECT: ConnectionAction = { kind: 'connect', label: 'connect' };
const RECHECK: ConnectionAction = { kind: 'recheck', label: 'recheck' };
const DISCONNECT: ConnectionAction = { kind: 'disconnect', label: 'disconnect' };

const CONNECT_CLI: ConnectionAction = { kind: 'connect', label: 'connect-github-cli' };
const CHECK_CLI: ConnectionAction = { kind: 'connect', label: 'recheck' };
const LOGIN_CLI: ConnectionAction = { kind: 'fix', fix: 'connect-github-cli', label: 'connect-github-cli' };
const INSTALL_CLI: ConnectionAction = { kind: 'fix', fix: 'install-github-cli', label: 'install-github-cli' };

function gitHubDisconnectedActions(step: GitHubCliStep | undefined): ConnectionAction[] {
  switch (step) {
    case 'not-logged-in':
      return [LOGIN_CLI];
    case 'login-opened':
      return [LOGIN_CLI, CHECK_CLI];
    case 'not-installed':
      return [INSTALL_CLI];
    case 'install-opened':
      return [INSTALL_CLI, CHECK_CLI];
    case undefined:
      return [CONNECT_CLI];
  }
}

export function actionsFor(id: ConnectionId, status: ConnectionStatus): ConnectionAction[] {
  const disconnectable = connectionDefinition(id).disconnectable;
  switch (status.state) {
    case 'unknown':
    case 'checking':
      return [];
    case 'disconnected':
      return id === 'github' ? gitHubDisconnectedActions(status.cli) : [CONNECT];
    case 'connected':
      return disconnectable ? [DISCONNECT] : [];
    case 'error': {
      const fix = FIX_FOR[status.problem];
      const actions: ConnectionAction[] = [{ kind: 'fix', fix, label: fix }];
      if (fix !== 'retry') actions.push(RECHECK);
      if (disconnectable) actions.push(DISCONNECT);
      return actions;
    }
  }
}

export function actionsForProblem(id: ConnectionId, problem: ConnectionProblem): ConnectionAction[] {
  return actionsFor(id, statusForProblem(problem)).filter((action) => action.kind !== 'disconnect');
}
