import { describe, expect, it } from 'vitest';
import type { PullRequest } from '../../../domain/pull-requests';
import { Localizer } from '../../i18n';
import { badgesFor as badgesWith, slaFor } from './pull-request-view';

const PT = new Localizer('pt-BR');
const badgesFor = (pr: PullRequest) => badgesWith(pr, PT);

const BASE: PullRequest = {
  id: 'a',
  number: 1,
  title: 't',
  url: 'https://github.com/acme/api/pull/1',
  repo: 'acme/api',
  author: 'ana',
  state: 'open',
  isDraft: false,
  ci: 'none',
  review: 'none',
  merge: 'unknown',
  createdAt: 0,
  updatedAt: 0,
};

describe('badgesFor', () => {
  it('a PR without information has no badges', () => {
    expect(badgesFor(BASE)).toEqual([]);
  });

  it('shows draft, CI, review decision and conflict', () => {
    const badges = badgesFor({ ...BASE, isDraft: true, ci: 'failure', review: 'changes-requested', merge: 'conflicting' });
    expect(badges.map((badge) => badge.label)).toEqual(['Rascunho', '✗ CI', 'Mudanças pedidas', 'Conflito']);
    expect(badges.map((badge) => badge.tone)).toEqual(['muted', 'bad', 'info', 'bad']);
  });

  it('covers the CI and review states', () => {
    expect(badgesFor({ ...BASE, ci: 'success', review: 'approved' }).map((badge) => badge.label)).toEqual(['✓ CI', 'Aprovado']);
    expect(badgesFor({ ...BASE, ci: 'pending', review: 'review-required' }).map((badge) => badge.label)).toEqual([
      '… CI',
      'Aguardando review',
    ]);
  });

  it('a PR already closed shows its state and hides the review decision', () => {
    expect(badgesFor({ ...BASE, state: 'merged', review: 'approved' }).map((badge) => badge.label)).toEqual(['Mergeado']);
    expect(badgesFor({ ...BASE, state: 'closed' }).map((badge) => badge.label)).toEqual(['Fechado']);
  });
});

describe('badge colors', () => {
  it('red only for failing CI and conflict; yellow never becomes a state badge', () => {
    const all: PullRequest[] = [
      { ...BASE, ci: 'success', review: 'approved' },
      { ...BASE, ci: 'pending', review: 'review-required' },
      { ...BASE, ci: 'failure', review: 'changes-requested', merge: 'conflicting' },
    ];
    const red = all.flatMap((pr) => badgesFor(pr)).filter((badge) => badge.tone === 'bad');
    expect(red.map((badge) => badge.label)).toEqual(['✗ CI', 'Conflito']);
  });
});

describe('slaFor', () => {
  const DAY = 24 * 60 * 60_000;
  const NOW = 10 * DAY;

  it('classifies an open PR by its age since opening', () => {
    expect(slaFor({ ...BASE, createdAt: NOW - 2 * DAY }, NOW)).toBe('fresh');
    expect(slaFor({ ...BASE, createdAt: NOW - 3 * DAY }, NOW)).toBe('attention');
    expect(slaFor({ ...BASE, createdAt: NOW - 7 * DAY }, NOW)).toBe('overdue');
  });

  it('a merged or closed PR has no SLA', () => {
    expect(slaFor({ ...BASE, state: 'merged', createdAt: 0 }, NOW)).toBeNull();
    expect(slaFor({ ...BASE, state: 'closed', createdAt: 0 }, NOW)).toBeNull();
  });
});
