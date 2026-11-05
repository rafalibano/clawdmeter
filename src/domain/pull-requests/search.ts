const DAY_MS = 86_400_000;

export const RECENT_REVIEW_DAYS = 30;

const SORT = 'sort:updated-desc';

export const MINE_QUERY = `author:@me is:open is:pr archived:false ${SORT}`;
export const TO_REVIEW_QUERY = `review-requested:@me is:open is:pr archived:false ${SORT}`;
export const REVIEWED_OPEN_QUERY = `reviewed-by:@me -author:@me is:open is:pr archived:false ${SORT}`;

function sinceDate(now: number, days: number): string {
  return new Date(now - days * DAY_MS).toISOString().slice(0, 10);
}

export function reviewedRecentQuery(now: number, days: number = RECENT_REVIEW_DAYS): string {
  return `reviewed-by:@me -author:@me is:pr archived:false is:closed closed:>=${sinceDate(now, days)} ${SORT}`;
}

export function reviewedAllQuery(now: number, days: number = RECENT_REVIEW_DAYS): string {
  return `reviewed-by:@me -author:@me is:pr archived:false (is:open OR closed:>=${sinceDate(now, days)}) ${SORT}`;
}

export function searchPageUrl(query: string): string {
  return `https://github.com/pulls?q=${encodeURIComponent(query)}`;
}
