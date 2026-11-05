import { slaLevel, type PullRequest, type SlaLevel } from '../../../domain/pull-requests';

export type BadgeTone = 'ok' | 'info' | 'bad' | 'muted';

export interface PullRequestBadge {
  label: string;
  tone: BadgeTone;
}

const CI: Record<string, PullRequestBadge> = {
  success: { label: '✓ CI', tone: 'ok' },
  failure: { label: '✗ CI', tone: 'bad' },
  pending: { label: '… CI', tone: 'muted' },
};

const REVIEW: Record<string, PullRequestBadge> = {
  approved: { label: 'Aprovado', tone: 'ok' },
  'changes-requested': { label: 'Mudanças pedidas', tone: 'info' },
  'review-required': { label: 'Aguardando review', tone: 'muted' },
};

const STATE: Record<string, PullRequestBadge> = {
  merged: { label: 'Mergeado', tone: 'muted' },
  closed: { label: 'Fechado', tone: 'muted' },
};

export function badgesFor(pr: PullRequest): PullRequestBadge[] {
  const badges: PullRequestBadge[] = [];
  const state = STATE[pr.state];
  if (state) badges.push(state);
  if (pr.isDraft) badges.push({ label: 'Rascunho', tone: 'muted' });
  const ci = CI[pr.ci];
  if (ci) badges.push(ci);
  const review = pr.state === 'open' ? REVIEW[pr.review] : undefined;
  if (review) badges.push(review);
  if (pr.merge === 'conflicting') badges.push({ label: 'Conflito', tone: 'bad' });
  return badges;
}

export function slaFor(pr: PullRequest, now: number): SlaLevel | null {
  return pr.state === 'open' ? slaLevel(pr.createdAt, now) : null;
}
