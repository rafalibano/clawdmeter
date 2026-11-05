export type ConnectionId = 'claude' | 'github' | 'microsoft' | 'notifications';

export interface ConnectionDefinition {
  id: ConnectionId;
  label: string;
  disconnectable: boolean;
}

export const CONNECTIONS: readonly ConnectionDefinition[] = [
  { id: 'claude', label: 'Claude', disconnectable: true },
  { id: 'github', label: 'GitHub', disconnectable: true },
  { id: 'microsoft', label: 'Microsoft (Teams)', disconnectable: true },
  { id: 'notifications', label: 'Notificações', disconnectable: false },
];

export function connectionDefinition(id: ConnectionId): ConnectionDefinition {
  const definition = CONNECTIONS.find((connection) => connection.id === id);
  if (!definition) throw new Error(`Conexão desconhecida: ${id}`);
  return definition;
}
