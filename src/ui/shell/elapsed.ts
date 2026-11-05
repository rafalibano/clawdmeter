const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export function formatUpdatedAgo(updatedAt: number | null, now: number): string {
  if (updatedAt === null) return 'aguardando dados';
  const elapsed = Math.max(0, now - updatedAt);
  if (elapsed < MINUTE) return `atualizado há ${Math.floor(elapsed / SECOND)}s`;
  if (elapsed < HOUR) return `atualizado há ${Math.floor(elapsed / MINUTE)} min`;
  return `atualizado há ${Math.floor(elapsed / HOUR)} h`;
}
