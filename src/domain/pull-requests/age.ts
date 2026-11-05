const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatAge(since: number, now: number): string {
  const elapsed = Math.max(0, now - since);
  if (elapsed < HOUR) return `${Math.max(1, Math.floor(elapsed / MINUTE))} min`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h`;
  return `${Math.floor(elapsed / DAY)} d`;
}
