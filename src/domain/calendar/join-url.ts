const JOIN_HOSTS: readonly string[] = ['teams.microsoft.com', 'teams.live.com'];

export function teamsJoinUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const trusted =
    url.protocol === 'https:' &&
    JOIN_HOSTS.includes(url.hostname) &&
    url.port === '' &&
    url.username === '' &&
    url.password === '';
  return trusted ? url.toString() : null;
}
