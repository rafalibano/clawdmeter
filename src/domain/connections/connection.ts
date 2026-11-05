export type ConnectionId = 'claude' | 'github' | 'microsoft' | 'notifications';

export interface ConnectionDefinition {
  id: ConnectionId;
  disconnectable: boolean;
}

export const CONNECTIONS: readonly ConnectionDefinition[] = [
  { id: 'claude', disconnectable: true },
  { id: 'github', disconnectable: true },
  { id: 'microsoft', disconnectable: true },
  { id: 'notifications', disconnectable: false },
];

export function connectionDefinition(id: ConnectionId): ConnectionDefinition {
  const definition = CONNECTIONS.find((connection) => connection.id === id);
  if (!definition) throw new Error(`Unknown connection: ${id}`);
  return definition;
}
