import type { Localizer, MessageKey } from '../../i18n';
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

const REVIEW: Record<string, { key: MessageKey; tone: BadgeTone }> = {
  approved: { key: 'prs.badge.approved', tone: 'ok' },
  'changes-requested': { key: 'prs.badge.changes', tone: 'info' },
  'review-required': { key: 'prs.badge.awaiting', tone: 'muted' },
};

const STATE: Record<string, { key: MessageKey; tone: BadgeTone }> = {
  merged: { key: 'prs.badge.merged', tone: 'muted' },
  closed: { key: 'prs.badge.closed', tone: 'muted' },
};

export function badgesFor(pr: PullRequest, l: Localizer): PullRequestBadge[] {
  const badges: PullRequestBadge[] = [];
  const named = (entry: { key: MessageKey; tone: BadgeTone }): PullRequestBadge => ({ label: l.t(entry.key), tone: entry.tone });
  const state = STATE[pr.state];
  if (state) badges.push(named(state));
  if (pr.isDraft) badges.push({ label: l.t('prs.badge.draft'), tone: 'muted' });
  const ci = CI[pr.ci];
  if (ci) badges.push(ci);
  const review = pr.state === 'open' ? REVIEW[pr.review] : undefined;
  if (review) badges.push(named(review));
  if (pr.merge === 'conflicting') badges.push({ label: l.t('prs.badge.conflict'), tone: 'bad' });
  return badges;
}

export function slaFor(pr: PullRequest, now: number): SlaLevel | null {
  return pr.state === 'open' ? slaLevel(pr.createdAt, now) : null;
}
