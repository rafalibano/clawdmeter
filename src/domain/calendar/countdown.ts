const MINUTES_PER_HOUR = 60;

export function formatCountdown(minutes: number): string {
  if (minutes <= 0) return 'agora';
  if (minutes < MINUTES_PER_HOUR) return `em ${minutes} min`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? `em ${hours}h` : `em ${hours}h ${rest}min`;
}
