export function githubWebUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const trusted =
    url.protocol === 'https:' &&
    url.hostname === 'github.com' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '';
  return trusted ? url.toString() : null;
}
