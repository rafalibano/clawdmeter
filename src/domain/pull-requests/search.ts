const DAY_MS = 86_400_000;

export const RECENT_REVIEW_DAYS = 30;

export const MINE_QUERY = 'author:@me is:open is:pr archived:false';
export const TO_REVIEW_QUERY = 'review-requested:@me is:open is:pr archived:false';
export const REVIEWED_OPEN_QUERY = 'reviewed-by:@me -author:@me is:open is:pr archived:false';

export function reviewedRecentQuery(now: number, days: number = RECENT_REVIEW_DAYS): string {
  const since = new Date(now - days * DAY_MS).toISOString().slice(0, 10);
  return `reviewed-by:@me -author:@me is:pr is:closed closed:>=${since}`;
}

export function searchPageUrl(query: string): string {
  return `https://github.com/pulls?q=${encodeURIComponent(query)}`;
}
